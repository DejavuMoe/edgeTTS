import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

describe("native Edge WebSocket lifecycle", () => {
  it.each([
    "cancel-turn.end",
    "cancel-audio",
    "cancel-audio.metadata",
    "cancel-unstarted",
    "cancel-url-init",
    "timeout-url-init",
    "stale-close",
    "complete",
    "truncated",
  ])("keeps process and stream semantics intact: %s", (scenario) => {
    // Isolate uncaught dependency callbacks in a child, not Vitest's error handlers.
    // Exercise real ws frames and isolate any unhandled client callback failures.
    const child = spawnSync(
      process.execPath,
      [
        "--import",
        "tsx",
        "--input-type=module",
        "--eval",
        `
import assert from "node:assert/strict";
import { once } from "node:events";
import { WebSocketServer } from "ws";
import { EdgeTtsProvider } from "./src/index.ts";
import { NativeEdgeClient } from "./src/client.ts";
const server = new WebSocketServer({ host: "127.0.0.1", port: 0 });
await once(server, "listening");
NativeEdgeClient.getSynthUrl = async () => "ws://127.0.0.1:" + server.address().port;
let upstream;
let connections = 0;
let requestId;
let resolveRequest;
const requestReceived = new Promise(resolve => { resolveRequest = resolve; });
server.on("connection", socket => {
  connections++;
  upstream = socket;
  socket.on("message", data => {
    const message = data.toString();
    if (message.includes("Path:ssml")) {
      requestId = /X-RequestId:(.*?)\\r\\n/.exec(message)[1];
      resolveRequest();
    }
  });
});
const controller = new AbortController();
const scenario = ${JSON.stringify(scenario)};
const frame = (path, body = "") => {
  const headers = "X-RequestId:" + requestId + "\\r\\nPath:" + path + "\\r\\n";
  if (path !== "audio") return headers + "\\r\\n" + body;
  const length = Buffer.alloc(2);
  length.writeUInt16BE(Buffer.byteLength(headers));
  return Buffer.concat([length, Buffer.from(headers), Buffer.from(body)]);
};
try {
  if (scenario.endsWith("url-init")) {
    let resolveUrl;
    NativeEdgeClient.getSynthUrl = () => new Promise(resolve => { resolveUrl = resolve; });
    const opening = new EdgeTtsProvider({ setupTimeoutMs: 25 }).openSession(
      { voice: "en-US-JennyNeural" }, controller.signal,
    );
    const rejected = assert.rejects(opening,
      scenario === "cancel-url-init" ? { name: "AbortError" } : /setup timed out/);
    if (scenario === "cancel-url-init") controller.abort();
    await rejected;
    resolveUrl("ws://127.0.0.1:" + server.address().port);
    await new Promise(resolve => setTimeout(resolve, 100));
    assert.equal(connections, 0, "abandoned URL lookup must not open a socket");
  } else if (scenario === "stale-close") {
    const client = new NativeEdgeClient();
    const session = await new EdgeTtsProvider({ clientFactory: () => client }).openSession(
      { voice: "en-US-JennyNeural" }, controller.signal,
    );
    const first = await session.synthesize({ text: "first" }, controller.signal);
    await requestReceived;
    upstream.send(frame("turn.end"));
    for await (const chunk of first.audio) void chunk;
    const oldSocket = client.socket;
    const onclose = oldSocket.listeners("close")[0];
    oldSocket.removeListener("close", onclose);
    let deliverClose;
    const closeQueued = new Promise(resolve => {
      // Hold only callback delivery so the replacement is active when the old event runs.
      oldSocket.once("close", event => {
        deliverClose = () => onclose.call(oldSocket, event);
        resolve();
      });
    });
    upstream.close();
    await closeQueued;
    const nextRequest = new Promise(resolve => { resolveRequest = resolve; });
    const second = await session.synthesize({ text: "second" }, controller.signal);
    await nextRequest;
    assert.notEqual(client.socket, oldSocket);
    assert.equal(client.socket.readyState, 1);
    const consume = (async () => {
      const chunks = [];
      for await (const chunk of second.audio) chunks.push(Buffer.from(chunk));
      return Buffer.concat(chunks).toString();
    })();
    deliverClose();
    upstream.send(frame("audio", "second audio"));
    upstream.send(frame("turn.end"));
    try {
      assert.equal(await consume, "second audio");
    } finally {
      session.close();
    }
  } else {
  const result = await new EdgeTtsProvider().synthesize(
    { text: "synthetic regression sample", voice: "en-US-JennyNeural" },
    controller.signal,
  );
  await requestReceived;
  const iterator = result.audio[Symbol.asyncIterator]();
  if (scenario.startsWith("cancel-")) {
    const pending = scenario === "cancel-unstarted" ? null : iterator.next();
    const path = scenario === "cancel-unstarted" ? "turn.end" : scenario.slice(7);
    const closed = once(upstream, "close");
    // Queue a valid frame before cancellation; it arrives during the close handshake.
    upstream.send(frame(path, "late data"));
    controller.abort();
    await assert.rejects(pending ?? iterator.next(), { name: "AbortError" });
    await closed;
  } else {
    upstream.send(frame("audio", "audio bytes"));
    if (scenario === "complete") upstream.send(frame("turn.end"));
    else upstream.close();
    const consume = async () => {
      const chunks = [];
      for await (const chunk of result.audio) chunks.push(Buffer.from(chunk));
      return Buffer.concat(chunks).toString();
    };
    if (scenario === "complete") assert.equal(await consume(), "audio bytes");
    else await assert.rejects(consume(), /no turn.end received/);
  }
  }
} finally {
  controller.abort();
  for (const socket of server.clients) socket.terminate();
  await new Promise(resolve => server.close(resolve));
}
console.log("PASS");
`,
      ],
      {
        cwd: fileURLToPath(new URL("..", import.meta.url)),
        encoding: "utf8",
        env: { ...process.env, TSX_DISABLE_CACHE: "1" },
        timeout: 5_000,
      },
    );
    expect(child.error).toBeUndefined();
    expect(child.status, child.stderr).toBe(0);
    expect(child.stdout.trim()).toBe("PASS");
  });
});
