import type { Readable } from "node:stream";
import { OUTPUT_FORMAT } from "msedge-tts";
import type {
  SynthesisRequest,
  SynthesisResult,
  TtsAudioFormat,
  TtsProvider,
  TtsVoice,
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

function createAbortError(reason?: unknown): Error {
  if (reason instanceof Error) {
    return reason;
  }
  return new DOMException(
    typeof reason === "string" ? reason : "The operation was aborted",
    "AbortError",
  );
}

export const MAX_VOICE_ID_LENGTH = 128;
export const VOICE_ID_REGEX = /^[A-Za-z0-9_-]+$/;

export function isValidVoiceId(voice: unknown): voice is string {
  return (
    typeof voice === "string" &&
    voice.length > 0 &&
    voice.length <= MAX_VOICE_ID_LENGTH &&
    VOICE_ID_REGEX.test(voice)
  );
}

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

  constructor(
    private readonly stream: Readable,
    private readonly client: EdgeClient,
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
    this.client.close();
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
    if (!request.text || request.text.trim() === "") {
      throw new Error("Text must not be empty");
    }
    if (!request.voice || request.voice.trim() === "") {
      throw new Error("Voice must not be empty");
    }
    if (!isValidVoiceId(request.voice)) {
      throw new RangeError(`Invalid voice identifier: ${String(request.voice)}`);
    }

    const format: TtsAudioFormat = request.format ?? "mp3-48k";
    const formatDetails = FORMAT_CONFIG[format];
    if (!formatDetails) {
      throw new Error(`Unsupported audio format: ${String(format)}`);
    }

    const prosodyOptions = toEdgeProsody(request.prosody);

    if (signal.aborted) {
      throw createAbortError(signal.reason);
    }

    const client = this.clientFactory();
    let setupAbandoned = false;
    const setMetadataPromise = client.setMetadata(request.voice, formatDetails.outputFormat);
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

      if (signal.aborted) {
        throw createAbortError(signal.reason);
      }

      const escapedText = escapeXmlText(request.text);
      const { audioStream } = client.toStream(escapedText, prosodyOptions);

      return {
        format,
        contentType: formatDetails.contentType,
        audio: new ManagedEdgeAudioStream(audioStream, client, signal, this.audioIdleTimeoutMs),
      };
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
