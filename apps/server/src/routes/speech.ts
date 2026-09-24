import { Readable } from "node:stream";
import type {
  FastifyPluginAsync,
  FastifyReply,
  FastifyRequest,
  preHandlerAsyncHookHandler,
  preHandlerHookHandler,
} from "fastify";
import {
  type ApiError,
  type NativeSpeechRequest,
  NativeSpeechRequestSchema,
  type SpeechRequest,
  SpeechRequestSchema,
} from "@edgetts/shared";
import {
  isTtsError,
  type SynthesisRequest,
  type TtsAudioFormat,
  type TtsErrorCode,
  type TtsProsody,
} from "@edgetts/tts-core";
import type { TtsServicePort } from "../dependencies.js";
import { summarizeValidationIssues, type ValidationIssue } from "../validation-log.js";

export const SPEECH_SEGMENT_CODE_POINTS = 300;

export interface SpeechRoutesOptions {
  readonly rateLimiter?: preHandlerAsyncHookHandler | preHandlerHookHandler | undefined;
}

const INVALID_REQUEST_ERROR: ApiError = {
  error: { code: "INVALID_REQUEST", message: "Invalid speech request" },
};

const UPSTREAM_ERROR: ApiError = {
  error: { code: "UPSTREAM_ERROR", message: "Unable to synthesize speech" },
};

interface TtsErrorResponse {
  readonly status: number;
  readonly body: ApiError;
  readonly logMessage: string;
}

/** Exhaustive over TtsErrorCode: a new domain error code does not compile until mapped here. */
const TTS_ERROR_RESPONSES: Record<TtsErrorCode, TtsErrorResponse> = {
  capacity_exceeded: {
    status: 503,
    body: { error: { code: "SERVER_BUSY", message: "Speech synthesis capacity is full" } },
    logMessage: "Speech synthesis capacity full",
  },
};

type ParseResult<Body> =
  | { readonly success: true; readonly data: Body }
  | { readonly success: false; readonly error: { readonly issues: readonly ValidationIssue[] } };

/** Everything that differs between the speech endpoints; the request lifecycle is shared. */
interface SpeechEndpoint<Body> {
  readonly schema: { safeParse(input: unknown): ParseResult<Body> };
  readonly toSynthesisRequest: (body: Body) => SynthesisRequest;
  /** Validated, non-sensitive fields attached to every log entry. Never includes input text. */
  readonly logContext: (body: Body) => Record<string, unknown>;
  readonly responseHeaders?: (segmentCount: number) => Record<string, string>;
  readonly logMessages: {
    readonly invalidRequest: string;
    readonly streamError: string;
    readonly preStreamFailure: string;
  };
}

const OPENAI_SPEECH: SpeechEndpoint<SpeechRequest> = {
  schema: SpeechRequestSchema,
  toSynthesisRequest: (body) => ({
    text: body.input,
    voice: body.voice,
    format: body.model === "tts-1-hd" ? "mp3-96k" : "mp3-48k",
    ...(body.speed !== undefined ? { prosody: { speed: body.speed } } : {}),
  }),
  logContext: (body) => ({ model: body.model, voice: body.voice }),
  logMessages: {
    invalidRequest: "Invalid speech request",
    streamError: "Audio stream error occurred during playback",
    preStreamFailure: "Pre-stream speech synthesis failed",
  },
};

const NATIVE_SPEECH: SpeechEndpoint<NativeSpeechRequest> = {
  schema: NativeSpeechRequestSchema,
  toSynthesisRequest: (body) => {
    const prosody: TtsProsody = {
      ...(body.speed !== undefined ? { speed: body.speed } : {}),
      ...(body.pitchSemitones !== undefined ? { pitchSemitones: body.pitchSemitones } : {}),
      ...(body.volume !== undefined ? { volume: body.volume } : {}),
    };
    const format: TtsAudioFormat = body.quality === "high" ? "mp3-96k" : "mp3-48k";
    return {
      text: body.input,
      voice: body.voice,
      format,
      ...(Object.keys(prosody).length > 0 ? { prosody } : {}),
    };
  },
  logContext: (body) => ({ voice: body.voice }),
  responseHeaders: (segmentCount) => ({
    "X-EdgeTTS-Segment-Count": String(segmentCount),
    "X-EdgeTTS-Segment-Max-Code-Points": String(SPEECH_SEGMENT_CODE_POINTS),
  }),
  logMessages: {
    invalidRequest: "Invalid native speech request",
    streamError: "Audio stream error occurred during native playback",
    preStreamFailure: "Pre-stream native speech synthesis failed",
  },
};

export function createSpeechRoutes(
  ttsService: TtsServicePort,
  options?: SpeechRoutesOptions,
): FastifyPluginAsync {
  return async (fastify) => {
    const preHandler = options?.rateLimiter ? [options.rateLimiter] : [];
    fastify.post(
      "/v1/audio/speech",
      { preHandler },
      createSpeechHandler(ttsService, OPENAI_SPEECH),
    );
    fastify.post("/api/speech", { preHandler }, createSpeechHandler(ttsService, NATIVE_SPEECH));
  };
}

function createSpeechHandler<Body>(ttsService: TtsServicePort, endpoint: SpeechEndpoint<Body>) {
  return async (request: FastifyRequest, reply: FastifyReply) => {
    const parsed = endpoint.schema.safeParse(request.body);
    if (!parsed.success) {
      request.log.warn(
        { issues: summarizeValidationIssues(parsed.error.issues) },
        endpoint.logMessages.invalidRequest,
      );
      return reply.code(400).type("application/json").send(INVALID_REQUEST_ERROR);
    }

    const body = parsed.data;
    const logContext = endpoint.logContext(body);
    const client = watchClientDisconnect(request, reply);

    try {
      const result = await ttsService.synthesizeSegmented(
        endpoint.toSynthesisRequest(body),
        client.signal,
        { maxSegmentCodePoints: SPEECH_SEGMENT_CODE_POINTS },
      );

      const audioStream = Readable.from(result.audio);
      audioStream.on("error", (err: unknown) => {
        request.log.error({ err, ...logContext }, endpoint.logMessages.streamError);
        client.dispose();
      });

      return reply
        .code(200)
        .header("Content-Type", "audio/mpeg")
        .header("Cache-Control", "no-store")
        .headers(endpoint.responseHeaders?.(result.segmentCount) ?? {})
        .send(audioStream);
    } catch (error) {
      client.dispose();

      if (isTtsError(error)) {
        const response = TTS_ERROR_RESPONSES[error.code];
        request.log.warn(logContext, response.logMessage);
        return reply.code(response.status).type("application/json").send(response.body);
      }

      // The client is gone: there is nobody left to answer.
      if (
        client.signal.aborted ||
        (error instanceof Error && error.name === "AbortError") ||
        reply.raw.destroyed
      ) {
        return;
      }

      request.log.error({ err: error, ...logContext }, endpoint.logMessages.preStreamFailure);
      return reply.code(502).type("application/json").send(UPSTREAM_ERROR);
    }
  };
}

/** Aborts synthesis when the client disconnects before the response has finished. */
function watchClientDisconnect(
  request: FastifyRequest,
  reply: FastifyReply,
): { readonly signal: AbortSignal; readonly dispose: () => void } {
  const controller = new AbortController();
  if (request.raw.aborted) {
    controller.abort();
  }

  let finished = false;
  const dispose = () => {
    reply.raw.removeListener("finish", onFinish);
    reply.raw.removeListener("close", onClose);
  };
  const onFinish = () => {
    finished = true;
    dispose();
  };
  const onClose = () => {
    if (!finished) {
      controller.abort();
    }
    dispose();
  };

  reply.raw.once("finish", onFinish);
  reply.raw.once("close", onClose);
  return { signal: controller.signal, dispose };
}
