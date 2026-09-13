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

export class EdgeTtsProvider implements TtsProvider {
  private readonly clientFactory: EdgeClientFactory;

  constructor(clientFactory: EdgeClientFactory = defaultEdgeClientFactory) {
    this.clientFactory = clientFactory;
  }

  async listVoices(): Promise<readonly TtsVoice[]> {
    const client = this.clientFactory();
    try {
      const rawVoices = await client.getVoices();
      return rawVoices.map((v): TtsVoice => ({
        id: v.ShortName,
        displayName: v.FriendlyName,
        locale: v.Locale,
        gender: v.Gender,
        ...(v.Status !== undefined ? { status: v.Status } : {}),
        ...(v.SuggestedCodec !== undefined ? { suggestedCodec: v.SuggestedCodec } : {}),
      }));
    } finally {
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
    try {
      await client.setMetadata(request.voice, formatDetails.outputFormat);

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
      client.close();
      throw error;
    }
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
