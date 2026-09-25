import type { Readable } from "node:stream";
import { OUTPUT_FORMAT } from "msedge-tts";
import {
  createAbortError,
  isValidVoiceId,
  type SessionSynthesisRequest,
  type SynthesisRequest,
  type SynthesisResult,
  type SynthesisSession,
  type SynthesisSessionOptions,
  type TtsAudioFormat,
  type TtsProvider,
  type TtsVoice,
} from "@edgetts/tts-core";
import { defaultEdgeClientFactory, type EdgeClient, type EdgeClientFactory } from "./client.js";
import { toEdgeProsody } from "./prosody.js";
import { escapeXmlText } from "./xml.js";

interface FormatDetails {
  readonly outputFormat: OUTPUT_FORMAT;
  readonly contentType: "audio/mpeg" | "audio/webm";
}

const FORMAT_CONFIG: Record<TtsAudioFormat, FormatDetails> = {
  "mp3-48k": {
    outputFormat: OUTPUT_FORMAT.AUDIO_24KHZ_48KBITRATE_MONO_MP3,
    contentType: "audio/mpeg",
  },
  "mp3-96k": {
    outputFormat: OUTPUT_FORMAT.AUDIO_24KHZ_96KBITRATE_MONO_MP3,
    contentType: "audio/mpeg",
  },
  "webm-opus": {
    outputFormat: OUTPUT_FORMAT.WEBM_24KHZ_16BIT_MONO_OPUS,
    contentType: "audio/webm",
  },
};

export const DEFAULT_LIST_VOICES_TIMEOUT_MS = 10_000;
export const DEFAULT_SETUP_TIMEOUT_MS = 10_000;
export const DEFAULT_AUDIO_IDLE_TIMEOUT_MS = 120_000;

function assertPositiveTimeout(value: number, name: string): void {
  if (!Number.isSafeInteger(value) || value < 1) {
    throw new RangeError(`${name} must be a positive integer`);
  }
}

class ManagedEdgeAudioStream implements AsyncIterableIterator<Uint8Array> {
  private readonly iterator: AsyncIterator<Uint8Array>;
  private readonly onAbort: () => void;
  private timer: NodeJS.Timeout | undefined;
  private closed = false;
  private started = false;

  /** `onClose` runs once when the stream ends, fails, times out or is aborted. */
  constructor(
    private readonly stream: Readable,
    private readonly onClose: () => void,
    private readonly signal: AbortSignal,
    private readonly timeoutMs: number,
  ) {
    this.iterator = stream[Symbol.asyncIterator]();
    this.onAbort = () => this.close(createAbortError(signal.reason));
    signal.addEventListener("abort", this.onAbort, { once: true });
    this.resetTimeout();
  }

  [Symbol.asyncIterator](): AsyncIterableIterator<Uint8Array> {
    return this;
  }

  private resetTimeout(): void {
    if (this.timer !== undefined) clearTimeout(this.timer);
    this.timer = setTimeout(
      () => this.close(new Error(`Speech synthesis audio timed out after ${this.timeoutMs}ms`)),
      this.timeoutMs,
    );
  }

  private close(error?: Error): void {
    if (this.closed) return;
    this.closed = true;
    if (this.timer !== undefined) clearTimeout(this.timer);
    this.signal.removeEventListener("abort", this.onAbort);
    this.stream.destroy(this.started ? error : undefined);
    this.onClose();
  }

  async next(): Promise<IteratorResult<Uint8Array>> {
    if (this.signal.aborted) {
      this.close(createAbortError(this.signal.reason));
      throw createAbortError(this.signal.reason);
    }
    if (this.closed) return { done: true, value: undefined };

    this.started = true;
    try {
      const item = await this.iterator.next();
      if (item.done) {
        this.close();
        return { done: true, value: undefined };
      }
      this.resetTimeout();
      if (item.value instanceof Uint8Array) {
        return {
          done: false,
          value: new Uint8Array(item.value.buffer, item.value.byteOffset, item.value.byteLength),
        };
      }
      if (typeof item.value === "string") {
        return { done: false, value: new TextEncoder().encode(item.value) };
      }
      throw new TypeError("Unsupported chunk type received from stream");
    } catch (error) {
      this.close();
      throw error;
    }
  }

  async return(value?: unknown): Promise<IteratorResult<Uint8Array>> {
    this.close();
    await this.iterator.return?.();
    return { done: true, value: value as undefined };
  }

  async throw(error?: unknown): Promise<IteratorResult<Uint8Array>> {
    this.close(error instanceof Error ? error : undefined);
    throw error;
  }
}

export interface EdgeTtsProviderOptions {
  readonly clientFactory?: EdgeClientFactory;
  readonly listVoicesTimeoutMs?: number;
  readonly setupTimeoutMs?: number;
  readonly audioIdleTimeoutMs?: number;
}

export class EdgeTtsProvider implements TtsProvider {
  private readonly clientFactory: EdgeClientFactory;
  private readonly listVoicesTimeoutMs: number;
  private readonly setupTimeoutMs: number;
  private readonly audioIdleTimeoutMs: number;

  constructor(options?: EdgeClientFactory | EdgeTtsProviderOptions) {
    if (typeof options === "function") {
      this.clientFactory = options;
      this.listVoicesTimeoutMs = DEFAULT_LIST_VOICES_TIMEOUT_MS;
      this.setupTimeoutMs = DEFAULT_SETUP_TIMEOUT_MS;
      this.audioIdleTimeoutMs = DEFAULT_AUDIO_IDLE_TIMEOUT_MS;
    } else {
      this.clientFactory = options?.clientFactory ?? defaultEdgeClientFactory;
      this.listVoicesTimeoutMs = options?.listVoicesTimeoutMs ?? DEFAULT_LIST_VOICES_TIMEOUT_MS;
      this.setupTimeoutMs = options?.setupTimeoutMs ?? DEFAULT_SETUP_TIMEOUT_MS;
      this.audioIdleTimeoutMs = options?.audioIdleTimeoutMs ?? DEFAULT_AUDIO_IDLE_TIMEOUT_MS;
    }
    assertPositiveTimeout(this.listVoicesTimeoutMs, "listVoicesTimeoutMs");
    assertPositiveTimeout(this.setupTimeoutMs, "setupTimeoutMs");
    assertPositiveTimeout(this.audioIdleTimeoutMs, "audioIdleTimeoutMs");
  }

  async listVoices(): Promise<readonly TtsVoice[]> {
    const client = this.clientFactory();
    let timer: NodeJS.Timeout | undefined;
    try {
      const getVoicesPromise = client.getVoices();
      getVoicesPromise.catch(() => {});

      const timeoutPromise = new Promise<never>((_, reject) => {
        timer = setTimeout(() => {
          reject(new Error(`Voice discovery timed out after ${this.listVoicesTimeoutMs}ms`));
        }, this.listVoicesTimeoutMs);
      });

      const rawVoices = await Promise.race([getVoicesPromise, timeoutPromise]);
      return rawVoices.map((v): TtsVoice => ({
        id: v.ShortName,
        displayName: v.FriendlyName,
        locale: v.Locale,
        gender: v.Gender,
        ...(v.Status !== undefined ? { status: v.Status } : {}),
        ...(v.SuggestedCodec !== undefined ? { suggestedCodec: v.SuggestedCodec } : {}),
      }));
    } finally {
      if (timer !== undefined) {
        clearTimeout(timer);
        timer = undefined;
      }
      client.close();
    }
  }

  async synthesize(request: SynthesisRequest, signal: AbortSignal): Promise<SynthesisResult> {
    assertText(request.text);
    const { format, details } = resolveVoiceAndFormat(request.voice, request.format);
    const prosodyOptions = toEdgeProsody(request.prosody);

    if (signal.aborted) {
      throw createAbortError(signal.reason);
    }

    const client = this.clientFactory();
    await this.configure(client, request.voice, details.outputFormat, signal);
    try {
      if (signal.aborted) {
        throw createAbortError(signal.reason);
      }
      const { audioStream } = client.toStream(escapeXmlText(request.text), prosodyOptions);
      return {
        format,
        contentType: details.contentType,
        audio: new ManagedEdgeAudioStream(
          audioStream,
          () => client.close(),
          signal,
          this.audioIdleTimeoutMs,
        ),
      };
    } catch (error) {
      client.close();
      throw error;
    }
  }

  /**
   * Opens one upstream connection for sequential syntheses with the same voice and format,
   * saving a TLS and WebSocket handshake per segment of long text.
   */
  async openSession(
    options: SynthesisSessionOptions,
    signal: AbortSignal,
  ): Promise<SynthesisSession> {
    const { format, details } = resolveVoiceAndFormat(options.voice, options.format);
    if (signal.aborted) {
      throw createAbortError(signal.reason);
    }

    const client = this.clientFactory();
    const configure = (setupSignal: AbortSignal) =>
      this.configure(client, options.voice, details.outputFormat, setupSignal);
    await configure(signal);
    return new EdgeSynthesisSession(client, configure, format, details, this.audioIdleTimeoutMs);
  }

  /**
   * Connects `client`, or keeps its open connection, within the setup timeout. Closes the
   * client on failure, including when a setup abandoned by abort or timeout settles later.
   */
  private async configure(
    client: EdgeClient,
    voice: string,
    outputFormat: OUTPUT_FORMAT,
    signal: AbortSignal,
  ): Promise<void> {
    let setupAbandoned = false;
    // Always pass options: msedge-tts throws on a repeated setMetadata call without them.
    const setMetadataPromise = client.setMetadata(voice, outputFormat, {});
    void setMetadataPromise
      .then(
        () => {
          if (setupAbandoned) client.close();
        },
        () => {
          if (setupAbandoned) client.close();
        },
      )
      .catch(() => {});

    try {
      await this.awaitWithAbortAndTimeout(
        setMetadataPromise,
        signal,
        this.setupTimeoutMs,
        `Speech synthesis setup timed out after ${this.setupTimeoutMs}ms`,
        () => {
          setupAbandoned = true;
          client.close();
        },
      );
    } catch (error) {
      if (!setupAbandoned) client.close();
      throw error;
    }
  }

  private async awaitWithAbortAndTimeout<T>(
    actionPromise: Promise<T>,
    signal: AbortSignal,
    timeoutMs: number,
    timeoutMessage: string,
    onAbandon: () => void,
  ): Promise<T> {
    if (signal.aborted) {
      onAbandon();
      throw createAbortError(signal.reason);
    }

    actionPromise.catch(() => {});

    return new Promise<T>((resolve, reject) => {
      let settled = false;
      let timer: NodeJS.Timeout | undefined;

      const cleanup = () => {
        settled = true;
        if (timer !== undefined) {
          clearTimeout(timer);
          timer = undefined;
        }
        signal.removeEventListener("abort", onAbort);
      };

      const onAbort = () => {
        if (settled) return;
        cleanup();
        onAbandon();
        reject(createAbortError(signal.reason));
      };

      signal.addEventListener("abort", onAbort, { once: true });

      timer = setTimeout(() => {
        if (settled) return;
        cleanup();
        onAbandon();
        reject(new Error(timeoutMessage));
      }, timeoutMs);

      actionPromise.then(
        (val) => {
          if (settled) return;
          cleanup();
          resolve(val);
        },
        (err) => {
          if (settled) return;
          cleanup();
          reject(err);
        },
      );
    });
  }
}

function assertText(text: string): void {
  if (!text || text.trim() === "") {
    throw new Error("Text must not be empty");
  }
}

function resolveVoiceAndFormat(
  voice: string,
  requestedFormat: TtsAudioFormat | undefined,
): { readonly format: TtsAudioFormat; readonly details: FormatDetails } {
  if (!voice || voice.trim() === "") {
    throw new Error("Voice must not be empty");
  }
  if (!isValidVoiceId(voice)) {
    throw new RangeError(`Invalid voice identifier: ${String(voice)}`);
  }
  const format: TtsAudioFormat = requestedFormat ?? "mp3-48k";
  const details = FORMAT_CONFIG[format];
  if (!details) {
    throw new Error(`Unsupported audio format: ${String(format)}`);
  }
  return { format, details };
}

class EdgeSynthesisSession implements SynthesisSession {
  private closed = false;
  private inFlight = false;

  constructor(
    private readonly client: EdgeClient,
    private readonly configure: (signal: AbortSignal) => Promise<void>,
    private readonly format: TtsAudioFormat,
    private readonly details: FormatDetails,
    private readonly audioIdleTimeoutMs: number,
  ) {}

  async synthesize(
    request: SessionSynthesisRequest,
    signal: AbortSignal,
  ): Promise<SynthesisResult> {
    if (this.closed) {
      throw new Error("Synthesis session is closed");
    }
    if (this.inFlight) {
      throw new Error("Synthesis session allows one synthesis at a time");
    }
    assertText(request.text);
    const prosodyOptions = toEdgeProsody(request.prosody);
    if (signal.aborted) {
      throw createAbortError(signal.reason);
    }

    this.inFlight = true;
    try {
      // A no-op while connected. If the service closed the idle socket, reconnect here under
      // the setup timeout: msedge-tts would otherwise reconnect inside toStream and leave a
      // failed reconnect as an unhandled rejection.
      await this.configure(signal);
      if (signal.aborted) {
        throw createAbortError(signal.reason);
      }
      const { audioStream } = this.client.toStream(escapeXmlText(request.text), prosodyOptions);
      return {
        format: this.format,
        contentType: this.details.contentType,
        audio: new ManagedEdgeAudioStream(
          audioStream,
          () => {
            this.inFlight = false;
          },
          signal,
          this.audioIdleTimeoutMs,
        ),
      };
    } catch (error) {
      this.inFlight = false;
      // The connection state is unknown after a failed setup; the session cannot continue.
      this.close();
      throw error;
    }
  }

  close(): void {
    if (this.closed) return;
    this.closed = true;
    this.client.close();
  }
}
