import { once } from "node:events";
import { createServer, type Server } from "node:http";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import WebSocket, { WebSocketServer } from "ws";
import { NativeEdgeClient } from "../src/client.js";
import { EdgeTtsProvider } from "../src/edge-provider.js";

function audioFrame(id: string, body: Uint8Array): Buffer {
  // Path is deliberately not the last header; audio starts at the declared byte offset.
  const headers = Buffer.from(`X-RequestId:${id}\r\nPath:audio\r\nContent-Type:audio/mpeg\r\n`);
  const size = Buffer.alloc(2);
  size.writeUInt16BE(headers.length);
  return Buffer.concat([size, headers, body]);
}

function endFrame(id: string): string {
  return `X-RequestId:${id}\r\nPath:turn.end\r\n\r\n`;
}

async function drain(audio: AsyncIterable<Uint8Array>): Promise<Buffer> {
  const chunks: Uint8Array[] = [];
  for await (const chunk of audio) chunks.push(chunk);
  return Buffer.concat(chunks);
}

describe("native Edge wire protocol", () => {
  let server: WebSocketServer;
  let client: NativeEdgeClient;
  let connections: number;
  let rejectHandshake: boolean;
  let stallHandshake: boolean;
  let handshakeStarted: Promise<void>;
  let startHandshake: () => void;
  let handshakeClosed: Promise<unknown> | undefined;

  beforeEach(async () => {
    connections = 0;
    rejectHandshake = false;
    stallHandshake = false;
    handshakeClosed = undefined;
    handshakeStarted = new Promise((resolve) => {
      startHandshake = resolve;
    });
    server = new WebSocketServer({
      host: "127.0.0.1",
      port: 0,
      verifyClient: (_info, accept) => {
        if (!stallHandshake) {
          accept(!rejectHandshake, 403);
        } else {
          // An unfinished upgrade is not in server.clients; observe and finish its TCP close.
          const socket = _info.req.socket;
          handshakeClosed = once(socket, "end").then(() => socket.destroy());
          socket.resume();
          startHandshake();
        }
      },
    });
    server.on("connection", () => {
      connections++;
    });
    await once(server, "listening");
    const address = server.address();
    if (!address || typeof address === "string") throw new Error("Expected a TCP listener");
    vi.spyOn(NativeEdgeClient, "getSynthUrl").mockResolvedValue(`ws://127.0.0.1:${address.port}`);
    client = new NativeEdgeClient();
  });

  afterEach(async () => {
    client.close();
    for (const socket of server.clients) socket.terminate();
    await new Promise<void>((resolve) => server.close(() => resolve()));
    vi.restoreAllMocks();
  });

  async function connect(
    format: "mp3-48k" | "mp3-96k" | "webm-opus" = "mp3-48k",
    voice = "zh-CN-XiaoxiaoNeural",
  ) {
    const connection = once(server, "connection").then(async (args) => {
      const socket = args[0] as WebSocket;
      const [config] = (await once(socket, "message")) as [Buffer];
      return { socket, config: config.toString() };
    });
    const provider = new EdgeTtsProvider({ clientFactory: () => client });
    const session = await provider.openSession({ voice, format }, new AbortController().signal);
    return { session, ...(await connection) };
  }

  it.each([
    ["mp3-48k", "audio-24khz-48kbitrate-mono-mp3"],
    ["mp3-96k", "audio-24khz-96kbitrate-mono-mp3"],
    ["webm-opus", "webm-24khz-16bit-mono-opus"],
  ] as const)(
    "streams %s and reuses one connection for sequential turns",
    async (format, wireFormat) => {
      const { session, socket, config } = await connect(format);
      expect(config).toContain("Path:speech.config\r\n\r\n");
      expect(JSON.parse(config.split("\r\n\r\n")[1]!)).toEqual({
        context: {
          synthesis: {
            audio: {
              metadataoptions: { sentenceBoundaryEnabled: false, wordBoundaryEnabled: false },
              outputFormat: wireFormat,
            },
          },
        },
      });
      let previousId = "previous-turn";
      for (let turn = 0; turn < 2; turn++) {
        const request = once(socket, "message");
        const result = await session.synthesize(
          {
            text: "a < b & c",
            prosody: { speed: 1.25, pitchSemitones: 2, volume: 0.8 },
          },
          new AbortController().signal,
        );
        const [data] = (await request) as [Buffer];
        const message = data.toString();
        expect(message).toContain('pitch="+2st" rate="1.25" volume="80"');
        expect(message).toContain("a &lt; b &amp; c");
        const id = /X-RequestId:([a-f0-9]{32})\r\n/.exec(message)![1]!;
        expect(id).not.toBe(previousId);
        socket.send(audioFrame(previousId, Buffer.from("late audio")));
        socket.send(endFrame(previousId));
        const expected = Buffer.from([
          0, 255, 13, 10, 80, 97, 116, 104, 58, 97, 117, 100, 105, 111,
        ]);
        socket.send(audioFrame(id, expected));
        socket.send(endFrame(id));
        expect(await drain(result.audio)).toEqual(expected);
        previousId = id;
      }
      expect(connections).toBe(1);
      session.close();
    },
  );

  it.each([
    ["fil-PH-AngeloNeural", "fil-PH"],
    ["iu-Latn-CA-SiqiniqNeural", "iu-Latn-CA"],
    ["zh-CN-liaoning-XiaobeiNeural", "zh-CN-liaoning"],
  ])("preserves the full language tag for %s", async (voice, locale) => {
    const { session, socket } = await connect("mp3-48k", voice);
    const request = once(socket, "message");
    const result = await session.synthesize({ text: "sample" }, new AbortController().signal);
    const [data] = (await request) as [Buffer];
    expect(data.toString()).toContain(`xml:lang="${locale}"`);
    const id = /X-RequestId:(.*?)\r\n/.exec(data.toString())![1]!;
    socket.send(audioFrame(id, Buffer.from("audio")));
    socket.send(endFrame(id));
    expect((await drain(result.audio)).toString()).toBe("audio");
    session.close();
  });

  it.each([Buffer.from([0]), Buffer.from([255, 255]), Buffer.from([0, 0])])(
    "rejects malformed binary frames without crashing the process: %j",
    async (frame) => {
      const { session, socket } = await connect();
      const request = once(socket, "message");
      const result = await session.synthesize({ text: "sample" }, new AbortController().signal);
      await request;
      socket.send(frame);
      await expect(drain(result.audio)).rejects.toThrow("Invalid Edge TTS protocol frame");
      session.close();
    },
  );

  it("drains buffered audio with backpressure before accepting the next turn", async () => {
    const { session, socket } = await connect();
    const request = once(socket, "message");
    const result = await session.synthesize({ text: "sample" }, new AbortController().signal);
    const [data] = (await request) as [Buffer];
    const id = /X-RequestId:(.*?)\r\n/.exec(data.toString())![1]!;
    const body = Buffer.alloc(256 * 1024, 42);
    socket.send(audioFrame(id, body));
    socket.send(audioFrame(id, body));
    socket.send(endFrame(id));
    expect(await drain(result.audio)).toEqual(Buffer.concat([body, body]));
    await client.setMetadata("zh-CN-XiaoxiaoNeural", "audio-24khz-48kbitrate-mono-mp3");
    expect(connections).toBe(1);
    session.close();
  });

  it("preserves upstream handshake status in the error", async () => {
    rejectHandshake = true;
    await expect(
      client.setMetadata("zh-CN-XiaoxiaoNeural", "audio-24khz-48kbitrate-mono-mp3"),
    ).rejects.toThrow("Unexpected server response: 403");
  });

  it.each(["abort", "timeout"])("closes an unfinished WebSocket handshake on %s", async (mode) => {
    stallHandshake = true;
    const controller = new AbortController();
    const opening = new EdgeTtsProvider({
      clientFactory: () => client,
      setupTimeoutMs: 30,
    }).openSession({ voice: "zh-CN-XiaoxiaoNeural" }, controller.signal);
    const rejected = expect(opening).rejects.toThrow(
      mode === "abort" ? /abort/i : /setup timed out/,
    );
    await handshakeStarted;
    if (mode === "abort") controller.abort();
    await rejected;
    expect(handshakeClosed).toBeDefined();
    await handshakeClosed;
    expect(connections).toBe(0);
  });

  it("reports close before consumption as truncation without an unhandled stream error", async () => {
    await connect();
    const { audioStream } = client.toStream("sample");
    client.close();
    await expect(drain(audioStream)).rejects.toThrow("no turn.end received");
  });
});

describe("native Edge voice discovery", () => {
  let server: Server;
  let catalog: unknown;
  let status: number;
  beforeEach(async () => {
    catalog = [];
    status = 200;
    vi.stubEnv("NO_PROXY", "*");
    vi.stubEnv("no_proxy", "*");
    server = createServer((_request, response) => {
      response.writeHead(status, { "content-type": "application/json" });
      response.end(JSON.stringify(catalog));
    });
    server.listen(0, "127.0.0.1");
    await once(server, "listening");
    const address = server.address();
    if (!address || typeof address === "string") throw new Error("Expected TCP listener");
    vi.spyOn(NativeEdgeClient, "getVoicesUrl").mockReturnValue(`http://127.0.0.1:${address.port}`);
  });
  afterEach(async () => {
    await new Promise<void>((resolve) => server.close(() => resolve()));
    vi.restoreAllMocks();
    vi.unstubAllEnvs();
  });
  const voice = {
    ShortName: "zh-CN-XiaoxiaoNeural",
    FriendlyName: "Xiaoxiao",
    Locale: "zh-CN",
    Gender: "Female",
  };

  it("preserves catalog metadata", async () => {
    catalog = [{ ...voice, Status: "GA", SuggestedCodec: "audio-24khz-48kbitrate-mono-mp3" }];
    const signal = new AbortController().signal;
    expect(await new NativeEdgeClient().getVoices(signal)).toEqual(catalog);
  });

  it("honors an already aborted request", async () => {
    await expect(new NativeEdgeClient().getVoices(AbortSignal.abort())).rejects.toThrow(/abort/i);
  });

  it.each([{}, [null], [{ ...voice, ShortName: "bad voice" }], [{ ...voice, Status: 7 }]])(
    "rejects malformed catalogs: %j",
    async (invalidCatalog) => {
      catalog = invalidCatalog;
      await expect(new NativeEdgeClient().getVoices(new AbortController().signal)).rejects.toThrow(
        "invalid voice catalog",
      );
    },
  );

  it("reports HTTP failures", async () => {
    status = 503;
    await expect(new NativeEdgeClient().getVoices(new AbortController().signal)).rejects.toThrow(
      "HTTP 503",
    );
  });
});
