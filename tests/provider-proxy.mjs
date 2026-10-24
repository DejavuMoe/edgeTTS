// Shared Node/Bun contract. Generate a local CA with tests/provider-proxy.sh.
import assert from "node:assert/strict";
import { Buffer } from "node:buffer";
import console from "node:console";
import { once } from "node:events";
import { readFileSync } from "node:fs";
import { createServer as httpServer } from "node:http";
import { createServer as httpsServer } from "node:https";
import { createRequire } from "node:module";
import { connect } from "node:net";
import { resolve } from "node:path";
import process from "node:process";
import { setTimeout as delay } from "node:timers/promises";
import { setTimeout } from "node:timers";
import { pathToFileURL, URL } from "node:url";

const { AbortSignal } = globalThis;

const entry = pathToFileURL(
  resolve(process.env.EDGETTS_PROVIDER_ENTRY || "packages/edge-provider/dist/index.js"),
);
const { defaultEdgeClientFactory } = await import(entry.href);
const { WebSocketServer } = createRequire(entry)("ws");
const tls = {
  key: readFileSync(process.argv[2]),
  cert: readFileSync(process.argv[3]),
};
const sockets = new Set();
const servers = [];
const catalog = [
  { ShortName: "en-US-AriaNeural", FriendlyName: "Aria", Locale: "en-US", Gender: "Female" },
];
const expectedAudio = Buffer.from([0xff, 0xfb, 0, 1, 2, 3]);
const connectRequests = [];
let rejectProxy = false;
let hangProxy = false;
let voiceRequests = 0;
let synthesisRequests = 0;

async function listen(server) {
  servers.push(server);
  server.on("connection", (socket) => {
    sockets.add(socket);
    socket.on("close", () => sockets.delete(socket));
    socket.on("end", () => socket.destroy());
    socket.on("error", () => {});
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  return server.address().port;
}

const upstream = httpsServer(tls, (request, response) => {
  assert.equal(request.headers["proxy-authorization"], undefined);
  voiceRequests++;
  response.writeHead(200, { "content-type": "application/json" });
  response.end(JSON.stringify(catalog));
});
const websocket = new WebSocketServer({ server: upstream });
websocket.on("connection", (socket, request) => {
  assert.equal(request.headers["proxy-authorization"], undefined);
  synthesisRequests++;
  socket.on("message", (data) => {
    const message = data.toString();
    if (!message.includes("Path:ssml")) return;
    const id = /X-RequestId:([a-f0-9]+)/.exec(message)[1];
    const header = Buffer.from(`X-RequestId:${id}\r\nPath:audio\r\n`);
    const size = Buffer.alloc(2);
    size.writeUInt16BE(header.length);
    socket.send(Buffer.concat([size, header, expectedAudio]));
    socket.send(`X-RequestId:${id}\r\nPath:turn.end\r\n\r\n`);
  });
});

function proxyServer(secure) {
  const server = secure ? httpsServer(tls) : httpServer();
  server.on("connect", (request, socket, head) => {
    connectRequests.push(request.headers["proxy-authorization"]);
    if (hangProxy) {
      // Consume EOF even while deliberately withholding the CONNECT response.
      socket.resume();
      return;
    }
    if (rejectProxy) {
      socket.resume();
      socket.end("HTTP/1.1 407 Proxy Authentication Required\r\nContent-Length: 0\r\n\r\n");
      return;
    }
    const destination = new URL(`https://${request.url}`);
    assert.equal(destination.hostname, "127.0.0.1");
    const remote = connect(Number(destination.port), "127.0.0.1");
    sockets.add(remote);
    remote.on("close", () => {
      sockets.delete(remote);
      socket.end(() => socket.destroy());
    });
    remote.on("error", () => socket.destroy());
    socket.on("close", () => remote.destroy());
    remote.on("connect", () => {
      socket.write("HTTP/1.1 200 Connection Established\r\n\r\n");
      if (head.length) remote.write(head);
      remote.pipe(socket);
      socket.pipe(remote);
    });
  });
  return server;
}

function clearProxyEnv() {
  for (const name of ["HTTPS_PROXY", "HTTP_PROXY", "NO_PROXY", "ALL_PROXY"]) {
    delete process.env[name];
    delete process.env[name.toLowerCase()];
  }
}

async function exercise() {
  const client = defaultEdgeClientFactory();
  try {
    assert.deepEqual(await client.getVoices(AbortSignal.timeout(3000)), catalog);
    await client.setMetadata("en-US-AriaNeural", "audio-24khz-48kbitrate-mono-mp3");
    const chunks = [];
    for await (const chunk of client.toStream("test").audioStream) chunks.push(chunk);
    assert.deepEqual(Buffer.concat(chunks), expectedAudio);
  } finally {
    client.close();
  }
}

try {
  const port = await listen(upstream);
  const Client = defaultEdgeClientFactory().constructor;
  Client.getVoicesUrl = () => `https://127.0.0.1:${port}/voices`;
  Client.getSynthUrl = async () => `wss://127.0.0.1:${port}/synthesis`;
  for (const secure of [false, true]) {
    console.log(`Checking ${secure ? "HTTPS" : "HTTP"} proxy`);
    const proxyPort = await listen(proxyServer(secure));
    clearProxyEnv();
    const proxy = `${secure ? "https" : "http"}://test:p%40ss@127.0.0.1:${proxyPort}`;
    process.env[secure ? "https_proxy" : "HTTP_PROXY"] = proxy;
    const count = connectRequests.length;
    await exercise();
    console.log("  CONNECT and synthesis completed");
    assert.equal(connectRequests.length - count, 2, "discovery and synthesis must both CONNECT");
    assert.deepEqual(
      connectRequests.slice(count),
      Array(2).fill(`Basic ${Buffer.from("test:p@ss").toString("base64")}`),
    );

    // A matching NO_PROXY must bypass a broken proxy for both transports.
    process.env.HTTPS_PROXY = "http://127.0.0.1:1";
    process.env.https_proxy = "http://127.0.0.1:1";
    process.env.NO_PROXY = `127.0.0.1:${port}`;
    await exercise();
    console.log("  NO_PROXY bypass completed");
    assert.equal(connectRequests.length, count + 2);

    clearProxyEnv();
    process.env.HTTPS_PROXY = proxy;
    rejectProxy = true;
    const beforeVoices = voiceRequests;
    const beforeSynthesis = synthesisRequests;
    const failed = defaultEdgeClientFactory();
    try {
      await assert.rejects(failed.getVoices(AbortSignal.timeout(3000)));
      await assert.rejects(
        failed.setMetadata("en-US-AriaNeural", "audio-24khz-48kbitrate-mono-mp3"),
      );
      assert.equal(voiceRequests, beforeVoices, "must not fall back to direct on proxy failure");
      assert.equal(synthesisRequests, beforeSynthesis);
    } finally {
      failed.close();
      rejectProxy = false;
    }

    hangProxy = true;
    console.log("  proxy failure completed; checking cancellation");
    const cancelled = defaultEdgeClientFactory();
    try {
      await assert.rejects(cancelled.getVoices(AbortSignal.timeout(100)));
      const opening = cancelled.setMetadata("en-US-AriaNeural", "audio-24khz-48kbitrate-mono-mp3");
      const closed = assert.rejects(opening);
      setTimeout(() => cancelled.close(), 100);
      await closed;
    } finally {
      cancelled.close();
      hangProxy = false;
    }
    for (let attempt = 0; sockets.size && attempt < 50; attempt++) await delay(20);
    assert.equal(sockets.size, 0, "completed and cancelled requests must release all sockets");
  }
  console.log(
    `PASS ${process.versions.bun ? "Bun" : "Node"}: HTTP/HTTPS CONNECT, credentials, NO_PROXY, failures and cancellation`,
  );
} finally {
  for (const client of websocket.clients) client.terminate();
  for (const socket of sockets) socket.destroy();
  await Promise.all(servers.map((server) => new Promise((done) => server.close(done))));
}
