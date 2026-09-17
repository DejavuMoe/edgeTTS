import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

describe("real msedge-tts WebSocket lifecycle", () => {
  it.each([
    "cancel-turn.end",
    "cancel-audio",
    "cancel-audio.metadata",
    "cancel-unstarted",
    "complete",
    "truncated",
  ])("keeps process and stream semantics intact: %s", (scenario) => {
    // Isolate uncaught dependency callbacks in a child, not Vitest's error handlers.
    // Resolve ws through the real dependency so no new test dependency is needed.
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
import { createRequire } from "node:module";
import { EdgeTtsProvider } from "./src/index.ts";
const require = createRequire(import.meta.url);
const { MsEdgeTTS } = require("msedge-tts");
const dependencyRequire = createRequire(require.resolve("msedge-tts"));
const { WebSocketServer } = createRequire(dependencyRequire.resolve("isomorphic-ws"))("ws");
const server = new WebSocketServer({ host: "127.0.0.1", port: 0 });
await once(server, "listening");
MsEdgeTTS.getSynthUrl = async () => "ws://127.0.0.1:" + server.address().port;
let upstream;
let requestId;
let resolveRequest;
const requestReceived = new Promise(resolve => { resolveRequest = resolve; });
server.on("connection", socket => {
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
try {
  const result = await new EdgeTtsProvider().synthesize(
    { text: "synthetic regression sample", voice: "en-US-JennyNeural" },
    controller.signal,
  );
  await requestReceived;
  const frame = (path, body = "") => Buffer.from(
    "X-RequestId:" + requestId + "\\r\\nPath:" + path + "\\r\\n" + body,
  );
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
