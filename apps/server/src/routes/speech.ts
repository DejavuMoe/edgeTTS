import { Readable } from "node:stream";
import type {
  FastifyPluginAsync,
  preHandlerAsyncHookHandler,
  preHandlerHookHandler,
} from "fastify";
import { type ApiError, NativeSpeechRequestSchema, SpeechRequestSchema } from "@edgetts/shared";
import type { SynthesisRequest, TtsAudioFormat, TtsProsody } from "@edgetts/tts-core";
import { SynthesisQueueFullError } from "@edgetts/tts-service";
import type { TtsServicePort } from "../dependencies.js";

export const NATIVE_SEGMENT_CODE_POINTS = 300;

export interface SpeechRoutesOptions {
  readonly rateLimiter?: preHandlerAsyncHookHandler | preHandlerHookHandler | undefined;
}

function mapSpeechModelToFormat(model: "tts-1" | "tts-1-hd"): TtsAudioFormat {
  switch (model) {
    case "tts-1":
      return "mp3-48k";
    case "tts-1-hd":
      return "mp3-96k";
  }
}

function mapNativeQualityToFormat(quality?: "standard" | "high"): TtsAudioFormat {
  switch (quality) {
    case "high":
      return "mp3-96k";
    case "standard":
    default:
      return "mp3-48k";
  }
}

export function createSpeechRoutes(
  ttsService: TtsServicePort,
  options?: SpeechRoutesOptions,
): FastifyPluginAsync {
  return async (fastify) => {
    const preHandlers = options?.rateLimiter ? [options.rateLimiter] : [];

    fastify.post(
      "/v1/audio/speech",
      {
        preHandler: preHandlers,
      },
      async (request, reply) => {
        const parsed = SpeechRequestSchema.safeParse(request.body);
        if (!parsed.success) {
          request.log.warn({ issues: parsed.error.issues }, "Invalid speech request");
          const errorPayload: ApiError = {
            error: {
              code: "INVALID_REQUEST",
              message: "Invalid speech request",
            },
          };
          return reply.code(400).type("application/json").send(errorPayload);
        }

        const validatedBody = parsed.data;
        const domainRequest: SynthesisRequest = {
          text: validatedBody.input,
          voice: validatedBody.voice,
          format: mapSpeechModelToFormat(validatedBody.model),
          ...(validatedBody.speed !== undefined ? { prosody: { speed: validatedBody.speed } } : {}),
        };

        const controller = new AbortController();

        if (request.raw.aborted) {
          controller.abort();
        }

        let finished = false;
        const onFinish = () => {
          finished = true;
          cleanup();
        };
        const onClose = () => {
          if (!finished) {
            controller.abort();
          }
          cleanup();
        };

        reply.raw.once("finish", onFinish);
        reply.raw.once("close", onClose);

        const cleanup = () => {
          reply.raw.removeListener("finish", onFinish);
          reply.raw.removeListener("close", onClose);
        };

        try {
          const result = await ttsService.synthesize(domainRequest, controller.signal);

          const audioStream = Readable.from(result.audio);
          audioStream.on("error", (err: unknown) => {
            request.log.error(
              { err, model: validatedBody.model, voice: validatedBody.voice },
              "Audio stream error occurred during playback",
            );
            cleanup();
          });

          return reply
            .code(200)
            .header("Content-Type", "audio/mpeg")
            .header("Cache-Control", "no-store")
            .send(audioStream);
        } catch (error) {
          cleanup();

          if (error instanceof SynthesisQueueFullError) {
            request.log.warn(
              { model: validatedBody.model, voice: validatedBody.voice },
              "Speech synthesis capacity full",
            );
            const errorPayload: ApiError = {
              error: {
                code: "SERVER_BUSY",
                message: "Speech synthesis capacity is full",
              },
            };
            return reply.code(503).type("application/json").send(errorPayload);
          }

          if (
            controller.signal.aborted ||
            (error instanceof Error && error.name === "AbortError") ||
            reply.raw.destroyed
          ) {
            return;
          }

          request.log.error(
            { err: error, model: validatedBody.model, voice: validatedBody.voice },
            "Pre-stream speech synthesis failed",
          );
          const errorPayload: ApiError = {
            error: {
              code: "UPSTREAM_ERROR",
              message: "Unable to synthesize speech",
            },
          };
          return reply.code(502).type("application/json").send(errorPayload);
        }
      },
    );

    fastify.post(
      "/api/speech",
      {
        preHandler: preHandlers,
      },
      async (request, reply) => {
        const parsed = NativeSpeechRequestSchema.safeParse(request.body);
        if (!parsed.success) {
          request.log.warn({ issues: parsed.error.issues }, "Invalid native speech request");
          const errorPayload: ApiError = {
            error: {
              code: "INVALID_REQUEST",
              message: "Invalid speech request",
            },
          };
          return reply.code(400).type("application/json").send(errorPayload);
        }

        const validatedBody = parsed.data;
        const prosody: TtsProsody = {
          ...(validatedBody.speed !== undefined ? { speed: validatedBody.speed } : {}),
          ...(validatedBody.pitchSemitones !== undefined
            ? { pitchSemitones: validatedBody.pitchSemitones }
            : {}),
          ...(validatedBody.volume !== undefined ? { volume: validatedBody.volume } : {}),
        };
        const hasProsody = Object.keys(prosody).length > 0;

        const domainRequest: SynthesisRequest = {
          text: validatedBody.input,
          voice: validatedBody.voice,
          format: mapNativeQualityToFormat(validatedBody.quality),
          ...(hasProsody ? { prosody } : {}),
        };

        const controller = new AbortController();

        if (request.raw.aborted) {
          controller.abort();
        }

        let finished = false;
        const onFinish = () => {
          finished = true;
          cleanup();
        };
        const onClose = () => {
          if (!finished) {
            controller.abort();
          }
          cleanup();
        };

        reply.raw.once("finish", onFinish);
        reply.raw.once("close", onClose);

        const cleanup = () => {
          reply.raw.removeListener("finish", onFinish);
          reply.raw.removeListener("close", onClose);
        };

        try {
          const result = await ttsService.synthesizeSegmented(domainRequest, controller.signal, {
            maxSegmentCodePoints: NATIVE_SEGMENT_CODE_POINTS,
          });

          const audioStream = Readable.from(result.audio);
          audioStream.on("error", (err: unknown) => {
            request.log.error(
              { err, voice: validatedBody.voice },
              "Audio stream error occurred during native playback",
            );
            cleanup();
          });

          return reply
            .code(200)
            .header("Content-Type", "audio/mpeg")
            .header("Cache-Control", "no-store")
            .header("X-EdgeTTS-Segment-Count", String(result.segmentCount))
            .header("X-EdgeTTS-Segment-Max-Code-Points", String(NATIVE_SEGMENT_CODE_POINTS))
            .send(audioStream);
        } catch (error) {
          cleanup();

          if (error instanceof SynthesisQueueFullError) {
            request.log.warn({ voice: validatedBody.voice }, "Speech synthesis capacity full");
            const errorPayload: ApiError = {
              error: {
                code: "SERVER_BUSY",
                message: "Speech synthesis capacity is full",
              },
            };
            return reply.code(503).type("application/json").send(errorPayload);
          }

          if (
            controller.signal.aborted ||
            (error instanceof Error && error.name === "AbortError") ||
            reply.raw.destroyed
          ) {
            return;
          }

          request.log.error(
            { err: error, voice: validatedBody.voice },
            "Pre-stream native speech synthesis failed",
          );
          const errorPayload: ApiError = {
            error: {
              code: "UPSTREAM_ERROR",
              message: "Unable to synthesize speech",
            },
          };
          return reply.code(502).type("application/json").send(errorPayload);
        }
      },
    );
  };
}
