import { afterEach, describe, expect, it, vi } from "vitest";
import type { FastifyInstance } from "fastify";
import { createApp } from "../src/app.js";

const key = "contract-test-key-1234567890";
const service = {
  listVoices: vi.fn(async () => []),
  synthesize: vi.fn(async () => {
    throw new Error("unused");
  }),
  synthesizeSegmented: vi.fn(async () => {
    throw new Error("unused");
  }),
};
let app: FastifyInstance | undefined;
afterEach(async () => {
  await app?.close();
  app = undefined;
  vi.unstubAllEnvs();
  vi.clearAllMocks();
});

describe("HTTP boundary", () => {
  it("normalizes parser errors, unknown routes and unexpected errors without exposing input or paths", async () => {
    app = createApp({ ttsService: service }, { apiKey: null, serveStatic: false });
    app.get("/unexpected", async () => {
      throw new Error("private /srv/internal/file");
    });
    app.get("/bad-status", async () => {
      throw Object.assign(new Error("private"), { statusCode: 200 });
    });
    for (const url of ["/api/speech", "/v1/audio/speech"]) {
      const invalid = await app.inject({
        method: "POST",
        url,
        headers: { "content-type": "application/json" },
        payload: '{"private_input":',
      });
      expect(invalid.statusCode).toBe(400);
      expect(invalid.json()).toEqual({
        error: { code: "INVALID_REQUEST", message: "Invalid request" },
      });
      const oversized = await app.inject({
        method: "POST",
        url,
        headers: { "content-type": "application/json" },
        payload: JSON.stringify({ input: "x".repeat(1024 * 1024) }),
      });
      expect(oversized.statusCode).toBe(413);
      expect(oversized.json().error.code).toBe("PAYLOAD_TOO_LARGE");
      const unsupported = await app.inject({
        method: "POST",
        url,
        headers: { "content-type": "application/xml" },
        payload: "<private/>",
      });
      expect(unsupported.statusCode).toBe(415);
      expect(unsupported.json().error.code).toBe("UNSUPPORTED_MEDIA_TYPE");
    }
    for (const url of ["/unexpected", "/bad-status"]) {
      const response = await app.inject(url);
      expect(response.statusCode).toBe(500);
      expect(response.json()).toEqual({
        error: { code: "INTERNAL_ERROR", message: "Internal server error" },
      });
    }
    const missing = await app.inject("/api/missing");
    expect(missing.statusCode).toBe(404);
    expect(missing.json().error.code).toBe("NOT_FOUND");
  });

  it("requires a key by default in production and preserves explicit external-auth mode", async () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("API_KEY", undefined);
    vi.stubEnv("REQUIRE_API_KEY", undefined);
    expect(() => createApp({ ttsService: service }, { serveStatic: false })).toThrow(
      "API_KEY is required",
    );
    app = createApp({ ttsService: service }, { apiKey: key, serveStatic: false });
    expect((await app.inject("/health")).statusCode).toBe(200);
    expect((await app.inject("/api/voices")).statusCode).toBe(401);
    expect(
      (await app.inject({ url: "/api/voices", headers: { authorization: `Bearer ${key}` } }))
        .statusCode,
    ).toBe(200);
    await app.close();
    app = createApp(
      { ttsService: service },
      { requireApiKey: false, apiKey: null, serveStatic: false },
    );
    expect((await app.inject("/api/voices")).statusCode).toBe(200);
  });

  it("limits voice discovery after auth without spending speech or health capacity", async () => {
    app = createApp({ ttsService: service }, { apiKey: key, serveStatic: false });
    for (let i = 0; i < 61; i++) expect((await app.inject("/api/voices")).statusCode).toBe(401);
    for (let i = 0; i < 60; i++) {
      expect(
        (await app.inject({ url: "/api/voices", headers: { authorization: `Bearer ${key}` } }))
          .statusCode,
      ).toBe(200);
    }
    const limited = await app.inject({
      url: "/api/voices",
      headers: { authorization: `Bearer ${key}` },
    });
    expect(limited.statusCode).toBe(429);
    expect(limited.json()).toEqual({
      error: { code: "RATE_LIMITED", message: "Too many voice requests" },
    });
    expect(service.listVoices).toHaveBeenCalledTimes(60);
    const speech = await app.inject({
      method: "POST",
      url: "/api/speech",
      headers: { authorization: `Bearer ${key}` },
      payload: {},
    });
    expect(speech.statusCode).toBe(400);
    expect((await app.inject("/health")).statusCode).toBe(200);
    for (const response of [limited, speech, await app.inject("/health")]) {
      expect(response.headers["x-content-type-options"]).toBe("nosniff");
      expect(response.headers["referrer-policy"]).toBe("strict-origin-when-cross-origin");
      expect(response.headers["permissions-policy"]).toBe(
        "microphone=(), camera=(), geolocation=()",
      );
      expect(response.headers["content-security-policy"]).toContain("media-src 'self' blob:");
      expect(response.headers["content-security-policy"]).toContain("script-src 'self';");
    }
  });
});
