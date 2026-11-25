import { describe, expect, it } from "vitest";
import { HealthResponseSchema, VoicesResponseSchema } from "@edgetts/shared";
import {
  InvalidResponseError,
  parseHealthResponse,
  parseVoicesResponse,
} from "../src/api/responses.js";

const VOICE = {
  id: "zh-CN-XiaoxiaoNeural",
  displayName: "Microsoft Xiaoxiao Online (Natural) - Chinese (Mainland)",
  locale: "zh-CN",
  gender: "Female",
  status: "GA",
  suggestedCodec: "audio-24khz-48kbitrate-mono-mp3",
};
const REQUIRED_ONLY = {
  id: VOICE.id,
  displayName: VOICE.displayName,
  locale: VOICE.locale,
  gender: VOICE.gender,
};

const HEALTH_SAMPLES: unknown[] = [
  { status: "ok" },
  { status: "ok", uptime: 12 },
  { status: "degraded" },
  {},
  null,
  "ok",
  [],
];

const VOICES_SAMPLES: unknown[] = [
  { voices: [] },
  { voices: [VOICE] },
  { voices: [REQUIRED_ONLY, VOICE] },
  { voices: [{ ...VOICE, upstreamOnly: "dropped" }], extra: true },
  { voices: [{ ...VOICE, status: undefined }] },
  { voices: [{ ...VOICE, status: null }] },
  { voices: [{ ...VOICE, suggestedCodec: 48 }] },
  { voices: [{ ...VOICE, id: 1 }] },
  { voices: [{ ...REQUIRED_ONLY, gender: undefined }] },
  { voices: [null] },
  { voices: [[]] },
  { voices: "zh-CN-XiaoxiaoNeural" },
  { voices: {} },
  {},
  null,
  [],
];

function outcome<T>(parse: () => T): { ok: true; value: T } | { ok: false } {
  try {
    return { ok: true, value: parse() };
  } catch {
    return { ok: false };
  }
}

describe("hand-written response parsers", () => {
  it.each(HEALTH_SAMPLES.map((sample) => [JSON.stringify(sample) ?? "undefined", sample]))(
    "accepts and returns health %s exactly as HealthResponseSchema does",
    (_label, sample) => {
      expect(outcome(() => parseHealthResponse(sample))).toEqual(
        outcome(() => HealthResponseSchema.parse(sample)),
      );
    },
  );

  it.each(VOICES_SAMPLES.map((sample) => [JSON.stringify(sample) ?? "undefined", sample]))(
    "accepts and returns voices %s exactly as VoicesResponseSchema does",
    (_label, sample) => {
      expect(outcome(() => parseVoicesResponse(sample))).toEqual(
        outcome(() => VoicesResponseSchema.parse(sample).voices),
      );
    },
  );

  it("reports a malformed body as an InvalidResponseError", () => {
    expect(() => parseVoicesResponse({ voices: [null] })).toThrow(InvalidResponseError);
    expect(() => parseHealthResponse({ status: "degraded" })).toThrow("Invalid health response");
  });

  it("drops fields the API does not document, as the schema strips them", () => {
    const [voice] = parseVoicesResponse({ voices: [{ ...REQUIRED_ONLY, upstreamOnly: 1 }] });
    expect(Object.keys(voice ?? {})).toEqual(["id", "displayName", "locale", "gender"]);
  });
});
