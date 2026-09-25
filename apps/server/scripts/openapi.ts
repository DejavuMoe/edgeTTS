// Builds the OpenAPI description of the HTTP API from the shared Zod schemas and the route
// constants, so the published contract cannot drift from validation.
//
// Usage: pnpm --filter @edgetts/server openapi   (writes docs/openapi.json)
// `pnpm test` fails when docs/openapi.json is stale.
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { zodToJsonSchema } from "zod-to-json-schema";
import {
  ApiErrorSchema,
  HealthResponseSchema,
  NativeSpeechRequestSchema,
  SpeechRequestSchema,
  VoicesResponseSchema,
} from "@edgetts/shared";
import { MAX_REQUEST_BODY_BYTES } from "../src/app.js";
import { SPEECH_SEGMENT_CODE_POINTS } from "../src/routes/speech.js";

export const OPENAPI_PATH = fileURLToPath(new URL("../../../docs/openapi.json", import.meta.url));

function schema(zodSchema: Parameters<typeof zodToJsonSchema>[0]): object {
  const jsonSchema: Record<string, unknown> = {
    ...zodToJsonSchema(zodSchema, { target: "openApi3", $refStrategy: "none" }),
  };
  // Component schemas are embedded in the document, so they carry no dialect of their own.
  delete jsonSchema["$schema"];
  return jsonSchema;
}

const json = (ref: string) => ({ "application/json": { schema: { $ref: ref } } });

function error(description: string) {
  return { description, content: json("#/components/schemas/ApiError") };
}

const MP3 = {
  description: "MP3 audio, streamed while it is synthesized.",
  content: { "audio/mpeg": { schema: { type: "string", format: "binary" } } },
};

const SPEECH_ERRORS = {
  "400": error("INVALID_REQUEST (validation failed) or UNKNOWN_VOICE (voice not in the catalog)."),
  "401": error("UNAUTHORIZED: missing or invalid API key."),
  "413": error(`PAYLOAD_TOO_LARGE: request body above ${MAX_REQUEST_BODY_BYTES} bytes.`),
  "415": error("UNSUPPORTED_MEDIA_TYPE: the body must be application/json."),
  "429": error("RATE_LIMITED: speech admission quota exceeded."),
  "502": error("UPSTREAM_ERROR: the upstream service failed before audio started."),
  "503": error("SERVER_BUSY: queue full, or queued longer than 30 seconds."),
};

const secured = [{ bearerAuth: [] }];

export function buildOpenApiDocument(): object {
  const { version } = JSON.parse(
    readFileSync(new URL("../../../package.json", import.meta.url), "utf8"),
  ) as { version: string };

  return {
    openapi: "3.0.3",
    info: {
      title: "edgeTTS API",
      version,
      description:
        "Self-hosted Microsoft Edge speech synthesis. Errors before audio headers use the " +
        "ApiError shape; failures after streaming starts terminate the connection.",
      license: { name: "MIT" },
    },
    servers: [{ url: "http://127.0.0.1:8080" }],
    paths: {
      "/v1/audio/speech": {
        post: {
          summary: "OpenAI-compatible speech synthesis",
          operationId: "createSpeechOpenAi",
          security: secured,
          requestBody: { required: true, content: json("#/components/schemas/SpeechRequest") },
          responses: { "200": MP3, ...SPEECH_ERRORS },
        },
      },
      "/api/speech": {
        post: {
          summary: "Native long-text streaming synthesis",
          description: `Text is split into segments of at most ${SPEECH_SEGMENT_CODE_POINTS} code points and streamed as one MP3.`,
          operationId: "createSpeech",
          security: secured,
          requestBody: {
            required: true,
            content: json("#/components/schemas/NativeSpeechRequest"),
          },
          responses: {
            "200": {
              ...MP3,
              headers: {
                "X-EdgeTTS-Segment-Count": {
                  description: "Number of synthesized segments.",
                  schema: { type: "integer", minimum: 1 },
                },
                "X-EdgeTTS-Segment-Max-Code-Points": {
                  description: "Maximum code points per segment.",
                  schema: { type: "integer", enum: [SPEECH_SEGMENT_CODE_POINTS] },
                },
              },
            },
            ...SPEECH_ERRORS,
          },
        },
      },
      "/api/voices": {
        get: {
          summary: "List available voices",
          operationId: "listVoices",
          security: secured,
          responses: {
            "200": {
              description: "Voice catalog.",
              content: json("#/components/schemas/VoicesResponse"),
            },
            "401": SPEECH_ERRORS["401"],
            "429": error("RATE_LIMITED: voice discovery quota exceeded."),
            "502": error("UPSTREAM_ERROR: the voice catalog could not be retrieved."),
          },
        },
      },
      "/health": {
        get: {
          summary: "Process liveness; does not contact the upstream service",
          operationId: "health",
          security: [],
          responses: {
            "200": {
              description: "The HTTP process is running.",
              content: json("#/components/schemas/HealthResponse"),
            },
          },
        },
      },
      "/api/health": {
        get: {
          summary: "Process liveness under the /api prefix",
          operationId: "apiHealth",
          security: [],
          responses: {
            "200": {
              description: "The HTTP process is running.",
              content: json("#/components/schemas/HealthResponse"),
            },
          },
        },
      },
      "/api/metrics": {
        get: {
          summary: "Prometheus metrics, only when METRICS_ENABLED=true",
          operationId: "metrics",
          security: secured,
          responses: {
            "200": {
              description: "Prometheus text exposition format 0.0.4.",
              content: { "text/plain": { schema: { type: "string" } } },
            },
            "401": SPEECH_ERRORS["401"],
          },
        },
      },
    },
    components: {
      securitySchemes: {
        bearerAuth: {
          type: "http",
          scheme: "bearer",
          description: "Required when the server has an API_KEY configured.",
        },
      },
      schemas: {
        SpeechRequest: schema(SpeechRequestSchema),
        NativeSpeechRequest: schema(NativeSpeechRequestSchema),
        VoicesResponse: schema(VoicesResponseSchema),
        HealthResponse: schema(HealthResponseSchema),
        ApiError: schema(ApiErrorSchema),
      },
    },
  };
}

export function renderOpenApiDocument(): string {
  return `${JSON.stringify(buildOpenApiDocument(), null, 2)}\n`;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  writeFileSync(OPENAPI_PATH, renderOpenApiDocument());
  console.log(`wrote ${OPENAPI_PATH}`);
}
