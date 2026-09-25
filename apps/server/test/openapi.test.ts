import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { OPENAPI_PATH, renderOpenApiDocument } from "../scripts/openapi.js";

interface JsonSchema {
  readonly properties?: Record<string, JsonSchema & { minimum?: number; maximum?: number }>;
  readonly required?: readonly string[];
  readonly additionalProperties?: boolean;
  readonly maxLength?: number;
}

describe("OpenAPI document", () => {
  const generated = renderOpenApiDocument();

  it("is up to date; run `pnpm --filter @edgetts/server openapi` after changing the API", () => {
    expect(readFileSync(OPENAPI_PATH, "utf8")).toBe(generated);
  });

  it("carries validation bounds from the shared schemas", () => {
    const document = JSON.parse(generated) as {
      components: { schemas: Record<string, JsonSchema> };
    };
    const native = document.components.schemas["NativeSpeechRequest"]!;
    const openAi = document.components.schemas["SpeechRequest"]!;

    expect(native.additionalProperties).toBe(false);
    expect(native.required).toEqual(["input", "voice"]);
    expect(native.properties?.["speed"]).toMatchObject({ minimum: 0.5, maximum: 2 });
    expect(native.properties?.["pitchSemitones"]).toMatchObject({ minimum: -12, maximum: 12 });
    expect(native.properties?.["volume"]).toMatchObject({ minimum: 0, maximum: 1 });
    expect(native.properties?.["voice"]).toMatchObject({ maxLength: 128 });
    expect(openAi.properties?.["input"]).toMatchObject({ maxLength: 4096 });
    expect(openAi.additionalProperties).toBe(false);
  });
});
