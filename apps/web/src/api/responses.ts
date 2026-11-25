import type { HealthResponse, VoiceDto } from "@edgetts/shared";

// Hand-written equivalents of HealthResponseSchema and VoicesResponseSchema from
// @edgetts/shared. Parsing two small responses with Zod would put all of Zod, about a quarter
// of the script, into the page. A test runs both against the same samples to keep them in step.

/** A response body did not have the shape the API documents. */
export class InvalidResponseError extends Error {
  constructor(what: string) {
    super(`Invalid ${what} response`);
    this.name = "InvalidResponseError";
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

const optionalString = (value: unknown): value is string | undefined =>
  value === undefined || typeof value === "string";

export function parseHealthResponse(data: unknown): HealthResponse {
  if (isRecord(data) && data["status"] === "ok") return { status: "ok" };
  throw new InvalidResponseError("health");
}

/** The catalog's voices, keeping only the documented fields as the schema does. */
export function parseVoicesResponse(data: unknown): VoiceDto[] {
  const voices = isRecord(data) ? data["voices"] : undefined;
  if (!Array.isArray(voices)) throw new InvalidResponseError("voices");
  return voices.map((voice: unknown): VoiceDto => {
    if (!isRecord(voice)) throw new InvalidResponseError("voices");
    const { id, displayName, locale, gender, status, suggestedCodec } = voice;
    if (
      typeof id !== "string" ||
      typeof displayName !== "string" ||
      typeof locale !== "string" ||
      typeof gender !== "string" ||
      !optionalString(status) ||
      !optionalString(suggestedCodec)
    ) {
      throw new InvalidResponseError("voices");
    }
    return {
      id,
      displayName,
      locale,
      gender,
      ...(status !== undefined ? { status } : {}),
      ...(suggestedCodec !== undefined ? { suggestedCodec } : {}),
    };
  });
}
