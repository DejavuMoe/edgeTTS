import { Writable } from "node:stream";
import { afterEach, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import { NativeSpeechRequestSchema, SpeechRequestSchema } from "@edgetts/shared";
import { createApp } from "../src/app.js";
import type { TtsServicePort } from "../src/dependencies.js";
import { summarizeValidationIssues } from "../src/validation-log.js";

const SENTINEL = "SENTINEL-7f3a";

const unusedService: TtsServicePort = {
  listVoices: () => Promise.reject(new Error("unexpected listVoices")),
  synthesize: () => Promise.reject(new Error("unexpected synthesize")),
  synthesizeSegmented: () => Promise.reject(new Error("unexpected synthesizeSegmented")),
};

function createLogCapture(): { stream: Writable; lines: () => string[] } {
  const chunks: string[] = [];
  const stream = new Writable({
    write(chunk: Buffer, _encoding, callback) {
      chunks.push(chunk.toString("utf8"));
      callback();
    },
  });
  return { stream, lines: () => chunks.join("").split("\n").filter(Boolean) };
}

describe("summarizeValidationIssues", () => {
  it("keeps only issue codes and field paths", () => {
    const parsed = SpeechRequestSchema.safeParse({
      model: SENTINEL,
      voice: "zh-CN-XiaoxiaoNeural",
      input: "hello",
      response_format: SENTINEL,
      [SENTINEL]: true,
    });
    expect(parsed.success).toBe(false);
    if (parsed.success) return;

    // The raw issues echo the rejected values; the summary must not.
    expect(JSON.stringify(parsed.error.issues)).toContain(SENTINEL);
    const summary = summarizeValidationIssues(parsed.error.issues);
    expect(JSON.stringify(summary)).not.toContain(SENTINEL);
    expect(summary).toEqual(
      expect.arrayContaining([
        { code: "invalid_enum_value", path: "model" },
        { code: "invalid_literal", path: "response_format" },
        { code: "unrecognized_keys", path: "" },
      ]),
    );
  });

  it("joins nested paths", () => {
    expect(summarizeValidationIssues([{ code: "custom", path: ["a", 0, "b"] }])).toEqual([
      { code: "custom", path: "a.0.b" },
    ]);
  });
});

describe("invalid speech request logging", () => {
  let app: FastifyInstance | undefined;

  afterEach(async () => {
    await app?.close();
    app = undefined;
  });

  it.each([
    {
      url: "/v1/audio/speech",
      message: "Invalid speech request",
      payload: {
        model: SENTINEL,
        voice: "zh-CN-XiaoxiaoNeural",
        input: "hello",
        response_format: SENTINEL,
        [SENTINEL]: true,
      },
    },
    {
      url: "/api/speech",
      message: "Invalid native speech request",
      payload: {
        input: "hello",
        voice: "zh-CN-XiaoxiaoNeural",
        quality: SENTINEL,
        [SENTINEL]: true,
      },
    },
  ])("does not log rejected request values for $url", async ({ url, message, payload }) => {
    // Guard the fixture itself: the payload must be invalid for the targeted schema.
    const schema = url === "/api/speech" ? NativeSpeechRequestSchema : SpeechRequestSchema;
    expect(schema.safeParse(payload).success).toBe(false);

    const capture = createLogCapture();
    app = createApp(
      { ttsService: unusedService },
      { logger: { level: "warn", stream: capture.stream } },
    );

    const response = await app.inject({ method: "POST", url, payload });

    expect(response.statusCode).toBe(400);
    const lines = capture.lines();
    const warning = lines.find((line) => line.includes(message));
    expect(warning).toBeDefined();
    expect(warning).toContain('"issues":[');
    expect(lines.join("\n")).not.toContain(SENTINEL);
  });
});
