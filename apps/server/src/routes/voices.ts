import type { FastifyPluginAsync, preHandlerHookHandler } from "fastify";
import type { ApiError, VoiceDto, VoicesResponse } from "@edgetts/shared";
import type { TtsServicePort } from "../dependencies.js";

export function createVoicesRoutes(
  ttsService: TtsServicePort,
  rateLimiter?: preHandlerHookHandler,
): FastifyPluginAsync {
  return async (fastify) => {
    fastify.get(
      "/voices",
      { preHandler: rateLimiter ? [rateLimiter] : [] },
      async (request, reply): Promise<VoicesResponse | ApiError> => {
        try {
          const rawVoices = await ttsService.listVoices();
          const voices: VoiceDto[] = rawVoices.map((v) => ({
            id: v.id,
            displayName: v.displayName,
            locale: v.locale,
            gender: v.gender,
            ...(v.status !== undefined ? { status: v.status } : {}),
            ...(v.suggestedCodec !== undefined ? { suggestedCodec: v.suggestedCodec } : {}),
          }));

          const responsePayload: VoicesResponse = { voices };
          return reply.code(200).type("application/json").send(responsePayload);
        } catch (error) {
          request.log.error({ err: error }, "Failed to retrieve TTS voices");
          const errorPayload: ApiError = {
            error: {
              code: "UPSTREAM_ERROR",
              message: "Unable to retrieve voices",
            },
          };
          return reply.code(502).type("application/json").send(errorPayload);
        }
      },
    );
  };
}
