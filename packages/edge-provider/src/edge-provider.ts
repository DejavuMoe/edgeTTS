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

export interface EdgeTtsProviderOptions {
  readonly clientFactory?: EdgeClientFactory;
  readonly listVoicesTimeoutMs?: number;
  readonly setupTimeoutMs?: number;
}

export class EdgeTtsProvider implements TtsProvider {
  private readonly clientFactory: EdgeClientFactory;
  private readonly listVoicesTimeoutMs: number;
  private readonly setupTimeoutMs: number;

  constructor(options?: EdgeClientFactory | EdgeTtsProviderOptions) {
    if (typeof options === "function") {
      this.clientFactory = options;
      this.listVoicesTimeoutMs = DEFAULT_LIST_VOICES_TIMEOUT_MS;
      this.setupTimeoutMs = DEFAULT_SETUP_TIMEOUT_MS;
    } else {
      this.clientFactory = options?.clientFactory ?? defaultEdgeClientFactory;
      this.listVoicesTimeoutMs = options?.listVoicesTimeoutMs ?? DEFAULT_LIST_VOICES_TIMEOUT_MS;
      this.setupTimeoutMs = options?.setupTimeoutMs ?? DEFAULT_SETUP_TIMEOUT_MS;
    }
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
        audio: this.createAudioIterable(audioStream, client, signal),
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

  private async *createAudioIterable(
    stream: Readable,
    client: EdgeClient,
    signal: AbortSignal,
  ): AsyncIterable<Uint8Array> {
    let closed = false;
    const closeClientOnce = () => {
      if (!closed) {
        closed = true;
        client.close();
      }
    };

    if (signal.aborted) {
      stream.destroy();
      closeClientOnce();
      throw createAbortError(signal.reason);
    }

    const onAbort = () => {
      stream.destroy(createAbortError(signal.reason));
      closeClientOnce();
    };
    signal.addEventListener("abort", onAbort, { once: true });

    try {
      for await (const chunk of stream) {
        if (signal.aborted) {
          throw createAbortError(signal.reason);
        }
        if (chunk instanceof Uint8Array) {
          yield new Uint8Array(chunk.buffer, chunk.byteOffset, chunk.byteLength);
        } else if (typeof chunk === "string") {
          yield new TextEncoder().encode(chunk);
        } else {
          throw new TypeError("Unsupported chunk type received from stream");
        }
      }
    } finally {
      signal.removeEventListener("abort", onAbort);
      stream.destroy();
      closeClientOnce();
    }
  }
}
