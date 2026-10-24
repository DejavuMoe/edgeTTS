import { describe, expect, it } from "vitest";
import { TtsService } from "@edgetts/tts-service";
import { createApp } from "../src/app.js";

describe.each(["/api/speech", "/v1/audio/speech"])("%s first audio bytes", (url) => {
  it.each([
    { name: "empty iterator", chunks: [], status: 502 },
    { name: "zero-length chunks", chunks: [Buffer.alloc(0), Buffer.alloc(0)], status: 502 },
    {
      name: "leading empty chunks",
      chunks: [Buffer.alloc(0), Buffer.from([0, 255, 42])],
      status: 200,
    },
    {
      name: "all bytes preserved",
      chunks: [Buffer.from([0, 255]), Buffer.from([42])],
      status: 200,
    },
  ])("handles $name", async ({ chunks, status }) => {
    let finished = false;
    const service = new TtsService({
      listVoices: async () => [],
      synthesize: async () => ({
        format: "mp3-48k",
        contentType: "audio/mpeg",
        audio: (async function* () {
          try {
            for (const chunk of chunks) yield chunk;
          } finally {
            finished = true;
          }
        })(),
      }),
    });
    const app = createApp({ ttsService: service }, { logger: false, requireApiKey: false });
    try {
      const response = await app.inject({
        method: "POST",
        url,
        payload: {
          input: "test",
          voice: "en-US-AriaNeural",
          ...(url.startsWith("/v1") ? { model: "tts-1" } : {}),
        },
      });
      expect(response.statusCode).toBe(status);
      if (status === 502) {
        expect(response.headers["content-type"]).toContain("application/json");
        expect(response.json()).toEqual({
          error: { code: "UPSTREAM_ERROR", message: "Unable to synthesize speech" },
        });
      } else {
        expect(response.rawPayload).toEqual(Buffer.concat(chunks));
        expect(response.headers["content-type"]).toBe("audio/mpeg");
      }
      expect(finished).toBe(true);
    } finally {
      await app.close();
    }
  });
});
