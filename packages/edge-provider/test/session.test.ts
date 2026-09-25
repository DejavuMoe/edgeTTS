import { PassThrough, Readable } from "node:stream";
import { describe, expect, it } from "vitest";
import { OUTPUT_FORMAT, type MetadataOptions, type ProsodyOptions, type Voice } from "msedge-tts";
import { EdgeTtsProvider } from "../src/edge-provider.js";
import type { EdgeClient } from "../src/client.js";

/**
 * Mirrors the msedge-tts contract that matters for sessions: setMetadata keeps an open
 * connection when nothing changed, and a repeated call without options throws.
 */
class SessionFakeClient implements EdgeClient {
  closeCalls = 0;
  readonly setMetadataCalls: Array<MetadataOptions | undefined> = [];
  readonly inputs: string[] = [];
  readonly prosody: Array<ProsodyOptions | undefined> = [];
  setMetadataHandler?: () => Promise<void>;
  nextStream: () => Readable = () => Readable.from([Buffer.from([1, 2])]);

  getVoices(): Promise<readonly Voice[]> {
    return Promise.resolve([]);
  }

  setMetadata(
    _voice: string,
    _format: OUTPUT_FORMAT,
    metadataOptions?: MetadataOptions,
  ): Promise<void> {
    if (this.setMetadataCalls.length > 0 && metadataOptions === undefined) {
      return Promise.reject(new TypeError("Cannot read properties of undefined"));
    }
    this.setMetadataCalls.push(metadataOptions);
    return this.setMetadataHandler?.() ?? Promise.resolve();
  }

  toStream(input: string, options?: ProsodyOptions): { audioStream: Readable } {
    this.inputs.push(input);
    this.prosody.push(options);
    return { audioStream: this.nextStream() };
  }

  close(): void {
    this.closeCalls++;
  }
}

async function drain(audio: AsyncIterable<Uint8Array>): Promise<number> {
  let bytes = 0;
  for await (const chunk of audio) bytes += chunk.byteLength;
  return bytes;
}

function setup(options?: { setupTimeoutMs?: number }) {
  const clients: SessionFakeClient[] = [];
  const provider = new EdgeTtsProvider({
    clientFactory: () => {
      const client = new SessionFakeClient();
      clients.push(client);
      return client;
    },
    ...(options?.setupTimeoutMs !== undefined ? { setupTimeoutMs: options.setupTimeoutMs } : {}),
  });
  return { provider, clients };
}

const signal = () => new AbortController().signal;

describe("EdgeTtsProvider sessions", () => {
  it("synthesizes sequential segments on one client and closes it only with the session", async () => {
    const { provider, clients } = setup();
    const session = await provider.openSession(
      { voice: "zh-CN-XiaoxiaoNeural", format: "mp3-96k" },
      signal(),
    );

    for (const text of ["第一段 <a>", "second & last"]) {
      const result = await session.synthesize({ text, prosody: { speed: 1.5 } }, signal());
      expect(result).toMatchObject({ format: "mp3-96k", contentType: "audio/mpeg" });
      expect(await drain(result.audio)).toBe(2);
    }

    expect(clients).toHaveLength(1);
    const client = clients[0]!;
    expect(client.inputs).toEqual(["第一段 &lt;a&gt;", "second &amp; last"]);
    expect(client.prosody.map((options) => options?.rate)).toEqual([1.5, 1.5]);
    // Every setMetadata call passes options, or msedge-tts would throw on the repeat call.
    expect(client.setMetadataCalls).toEqual([{}, {}, {}]);
    expect(client.closeCalls).toBe(0);

    session.close();
    session.close();
    expect(client.closeCalls).toBe(1);
    await expect(session.synthesize({ text: "late" }, signal())).rejects.toThrow(
      "Synthesis session is closed",
    );
  });

  it("allows only one synthesis in flight", async () => {
    const { provider, clients } = setup();
    const session = await provider.openSession({ voice: "zh-CN-XiaoxiaoNeural" }, signal());
    const open = new PassThrough();
    clients[0]!.nextStream = () => open;

    const first = await session.synthesize({ text: "one" }, signal());
    await expect(session.synthesize({ text: "two" }, signal())).rejects.toThrow(
      "Synthesis session allows one synthesis at a time",
    );

    open.end(Buffer.from([7]));
    expect(await drain(first.audio)).toBe(1);
    clients[0]!.nextStream = () => Readable.from([Buffer.from([8])]);
    const second = await session.synthesize({ text: "two" }, signal());
    expect(await drain(second.audio)).toBe(1);
    session.close();
  });

  it("closes the session when a reconnect exceeds the setup timeout", async () => {
    const { provider, clients } = setup({ setupTimeoutMs: 20 });
    const session = await provider.openSession({ voice: "zh-CN-XiaoxiaoNeural" }, signal());
    clients[0]!.setMetadataHandler = () => new Promise<void>(() => {});

    await expect(session.synthesize({ text: "segment" }, signal())).rejects.toThrow(
      "Speech synthesis setup timed out after 20ms",
    );
    expect(clients[0]!.closeCalls).toBeGreaterThanOrEqual(1);
    await expect(session.synthesize({ text: "again" }, signal())).rejects.toThrow(
      "Synthesis session is closed",
    );
  });

  it("aborting a segment ends its audio but leaves the connection to the session owner", async () => {
    const { provider, clients } = setup();
    const session = await provider.openSession({ voice: "zh-CN-XiaoxiaoNeural" }, signal());
    const open = new PassThrough();
    clients[0]!.nextStream = () => open;
    const controller = new AbortController();

    const result = await session.synthesize({ text: "segment" }, controller.signal);
    const iterator = result.audio[Symbol.asyncIterator]();
    open.write(Buffer.from([1]));
    await iterator.next();
    controller.abort();

    await expect(iterator.next()).rejects.toMatchObject({ name: "AbortError" });
    expect(open.destroyed).toBe(true);
    expect(clients[0]!.closeCalls).toBe(0);
    session.close();
    expect(clients[0]!.closeCalls).toBe(1);
  });

  it("closes the client when opening a session fails", async () => {
    const clients: SessionFakeClient[] = [];
    const provider = new EdgeTtsProvider({
      clientFactory: () => {
        const client = new SessionFakeClient();
        client.setMetadataHandler = () => Promise.reject(new Error("connect failed"));
        clients.push(client);
        return client;
      },
    });

    await expect(provider.openSession({ voice: "zh-CN-XiaoxiaoNeural" }, signal())).rejects.toThrow(
      "connect failed",
    );
    expect(clients[0]!.closeCalls).toBe(1);
  });

  it("validates the voice and format before connecting", async () => {
    const { provider, clients } = setup();
    await expect(provider.openSession({ voice: "bad voice!" }, signal())).rejects.toThrow(
      RangeError,
    );
    expect(clients).toHaveLength(0);
  });
});
