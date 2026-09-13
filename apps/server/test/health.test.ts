import { describe, it, expect, afterEach } from "vitest";
import type { FastifyInstance } from "fastify";
import type { TtsVoice } from "@edgetts/tts-core";
import { createApp } from "../src/app.js";
import type { TtsServicePort } from "../src/dependencies.js";

class FakeTtsService implements TtsServicePort {
  public listVoicesCalls = 0;

  async listVoices(): Promise<readonly TtsVoice[]> {
    this.listVoicesCalls++;
    return [];
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
  });
});
