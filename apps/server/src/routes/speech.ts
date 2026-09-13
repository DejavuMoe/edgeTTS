import { Readable } from "node:stream";
import type { FastifyPluginAsync } from "fastify";
import { type ApiError, SpeechRequestSchema } from "@edgetts/shared";
import type { SynthesisRequest, TtsAudioFormat } from "@edgetts/tts-core";
import type { TtsServicePort } from "../dependencies.js";

function mapSpeechModelToFormat(model: "tts-1" | "tts-1-hd"): TtsAudioFormat {
  switch (model) {
    case "tts-1":
      return "mp3-48k";
    case "tts-1-hd":
      return "mp3-96k";
  }
}

export function createSpeechRoutes(ttsService: TtsServicePort): FastifyPluginAsync {
  return async (fastify) => {
    fastify.post("/v1/audio/speech", async (request, reply) => {
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
    });
  };
}
