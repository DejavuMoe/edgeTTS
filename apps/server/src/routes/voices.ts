import type {
  FastifyPluginAsync,
  preHandlerAsyncHookHandler,
  preHandlerHookHandler,
} from "fastify";
import type { ApiError, VoiceDto, VoicesResponse } from "@edgetts/shared";
import type { TtsServicePort } from "../dependencies.js";
import { EncodedJsonCache, matchesIfNoneMatch, negotiateEncoding } from "../encoded-json.js";

export function createVoicesRoutes(
  ttsService: TtsServicePort,
  rateLimiter?: preHandlerAsyncHookHandler | preHandlerHookHandler,
): FastifyPluginAsync {
  return async (fastify) => {
    // The catalog is about 63 KB of JSON that compresses about tenfold and changes only when the
    // service refreshes its voice cache.
    const encodedVoices = new EncodedJsonCache();

    fastify.get(
      "/voices",
      { preHandler: rateLimiter ? [rateLimiter] : [] },
      async (request, reply): Promise<VoicesResponse | ApiError> => {
        let encoded;
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
          encoded = await encodedVoices.encode(responsePayload);
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

        // Revalidate on every use: an unchanged catalog costs a 304 instead of the whole body.
        // `private` keeps shared caches out, since the route may sit behind an API key.
        reply
          .header("ETag", encoded.etag)
          .header("Cache-Control", "private, no-cache")
          .header("Vary", "Accept-Encoding");
        if (matchesIfNoneMatch(request.headers["if-none-match"], encoded.etag)) {
          return reply.code(304).send();
        }

        const encoding = negotiateEncoding(request.headers["accept-encoding"]);
        reply.code(200).type("application/json");
        if (encoding === null) return reply.send(encoded.identity);
        return reply.header("Content-Encoding", encoding).send(encoded[encoding]);
      },
    );
  };
}
