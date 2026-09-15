import { describe, it, expect, afterEach } from "vitest";
import type { FastifyInstance } from "fastify";
import type { SynthesisResult, TtsVoice } from "@edgetts/tts-core";
import type { SegmentedSynthesisResult } from "@edgetts/tts-service";
import { createApp } from "../src/app.js";
import type { TtsServicePort } from "../src/dependencies.js";

class FakeTtsService implements TtsServicePort {
  public listVoicesCalls = 0;
  public synthesizeCalls = 0;

  async listVoices(): Promise<readonly TtsVoice[]> {
    this.listVoicesCalls++;
    return [];
  }

  async synthesize(): Promise<SynthesisResult> {
    this.synthesizeCalls++;
    return {
      format: "mp3-48k",
      contentType: "audio/mpeg",
      audio: (async function* () {})(),
    };
  }

  async synthesizeSegmented(): Promise<SegmentedSynthesisResult> {
    return {
      format: "mp3-48k",
      contentType: "audio/mpeg",
      segmentCount: 1,
      audio: (async function* () {})(),
    };
  }
}

describe("GET /api/health", () => {
  let app: FastifyInstance | undefined;

  afterEach(async () => {
    if (app) {
      await app.close();
    }
  });

  it("should return HTTP 200 with status ok and not touch ttsService", async () => {
    const fakeService = new FakeTtsService();
    app = createApp({ ttsService: fakeService });
    const response = await app.inject({
      method: "GET",
      url: "/api/health",
    });

    expect(response.statusCode).toBe(200);
    expect(response.headers["content-type"]).toContain("application/json");
    expect(response.json()).toEqual({ status: "ok" });
    expect(fakeService.listVoicesCalls).toBe(0);
    expect(fakeService.synthesizeCalls).toBe(0);
  });
});
