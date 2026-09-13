import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import type { FastifyInstance } from "fastify";
import type { SynthesisResult, TtsVoice } from "@edgetts/tts-core";
import { createApp } from "../src/app.js";
import type { TtsServicePort } from "../src/dependencies.js";
import { shouldEnableStaticHosting } from "../src/static.js";

class DummyTtsService implements TtsServicePort {
  async listVoices(): Promise<readonly TtsVoice[]> {
    return [];
  }
  async synthesize(): Promise<SynthesisResult> {
    return {
      format: "mp3-48k",
      contentType: "audio/mpeg",
      audio: (async function* () {})(),
    };
  }
  async synthesizeSegmented(): Promise<SynthesisResult> {
    return {
      format: "mp3-48k",
      contentType: "audio/mpeg",
      audio: (async function* () {})(),
    };
  }
}

describe("Production Static Web Hosting & SPA Fallback", () => {
  let tempDir: string;
  let app: FastifyInstance | undefined;
  const dummyService = new DummyTtsService();

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "edgetts-static-test-"));
    fs.writeFileSync(
      path.join(tempDir, "index.html"),
      '<!doctype html><html><head><title>EdgeTTS Workbench</title></head><body><div id="root">UI Root</div></body></html>',
    );
    fs.mkdirSync(path.join(tempDir, "assets"));
    fs.writeFileSync(
      path.join(tempDir, "assets", "index-test1234.js"),
      "console.log('edgetts bundle');",
    );
    fs.writeFileSync(
      path.join(tempDir, "assets", "index-test1234.css"),
      "body { background: #000; }",
    );
  });

  afterEach(async () => {
    if (app) {
      await app.close();
      app = undefined;
    }
    if (fs.existsSync(tempDir)) {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  });

  it("serves index.html at root '/' with no-cache header", async () => {
    app = createApp({ ttsService: dummyService }, { serveStatic: true, webDistDir: tempDir });

    const response = await app.inject({
      method: "GET",
      url: "/",
    });

    expect(response.statusCode).toBe(200);
    expect(response.headers["content-type"]).toContain("text/html");
    expect(response.headers["cache-control"]).toBe("no-cache");
    expect(response.body).toContain("EdgeTTS Workbench");
  });

  it("serves direct request to '/index.html' with no-cache header", async () => {
    app = createApp({ ttsService: dummyService }, { serveStatic: true, webDistDir: tempDir });

    const response = await app.inject({
      method: "GET",
      url: "/index.html",
    });

    expect(response.statusCode).toBe(200);
    expect(response.headers["content-type"]).toContain("text/html");
    expect(response.headers["cache-control"]).toBe("no-cache");
    expect(response.body).toContain("EdgeTTS Workbench");
  });

  it("serves hashed JS assets with immutable cache headers and correct mime type", async () => {
    app = createApp({ ttsService: dummyService }, { serveStatic: true, webDistDir: tempDir });

    const response = await app.inject({
      method: "GET",
      url: "/assets/index-test1234.js",
    });

    expect(response.statusCode).toBe(200);
    expect(response.headers["content-type"]).toContain("javascript");
    expect(response.headers["cache-control"]).toBe("public, max-age=31536000, immutable");
    expect(response.body).toBe("console.log('edgetts bundle');");
  });

  it("serves hashed CSS assets with immutable cache headers and correct mime type", async () => {
    app = createApp({ ttsService: dummyService }, { serveStatic: true, webDistDir: tempDir });

    const response = await app.inject({
      method: "GET",
      url: "/assets/index-test1234.css",
    });

    expect(response.statusCode).toBe(200);
    expect(response.headers["content-type"]).toContain("text/css");
    expect(response.headers["cache-control"]).toBe("public, max-age=31536000, immutable");
    expect(response.body).toBe("body { background: #000; }");
  });

  it("falls back to index.html for SPA client navigation paths without file extension", async () => {
    app = createApp({ ttsService: dummyService }, { serveStatic: true, webDistDir: tempDir });

    const response = await app.inject({
      method: "GET",
      url: "/workbench?model=tts-1#top",
    });

    expect(response.statusCode).toBe(200);
    expect(response.headers["content-type"]).toContain("text/html");
    expect(response.headers["cache-control"]).toBe("no-cache");
    expect(response.body).toContain("EdgeTTS Workbench");
  });

  it("handles HEAD requests to SPA paths properly without returning body", async () => {
    app = createApp({ ttsService: dummyService }, { serveStatic: true, webDistDir: tempDir });

    const response = await app.inject({
      method: "HEAD",
      url: "/workbench",
    });

    expect(response.statusCode).toBe(200);
    expect(response.headers["content-type"]).toContain("text/html");
    expect(response.body).toBe("");
  });

  it("does not fallback to index.html for missing static files with extensions", async () => {
    app = createApp({ ttsService: dummyService }, { serveStatic: true, webDistDir: tempDir });

    const response = await app.inject({
      method: "GET",
      url: "/assets/non-existent.js",
    });

    expect(response.statusCode).toBe(404);
    expect(response.body).not.toContain("EdgeTTS Workbench");
  });

  it("does not fallback to index.html for non-GET/HEAD requests to client routes", async () => {
    app = createApp({ ttsService: dummyService }, { serveStatic: true, webDistDir: tempDir });

    const response = await app.inject({
      method: "POST",
      url: "/workbench",
    });

    expect(response.statusCode).toBe(404);
    expect(response.body).not.toContain("EdgeTTS Workbench");
  });

  it("preserves API routes (/api/* and /v1/*) without SPA interference", async () => {
    app = createApp({ ttsService: dummyService }, { serveStatic: true, webDistDir: tempDir });

    const healthRes = await app.inject({
      method: "GET",
      url: "/api/health",
    });
    expect(healthRes.statusCode).toBe(200);
    expect(healthRes.json()).toEqual({ status: "ok" });

    const rootHealthRes = await app.inject({
      method: "GET",
      url: "/health",
    });
    expect(rootHealthRes.statusCode).toBe(200);
    expect(rootHealthRes.json()).toEqual({ status: "ok" });
  });

  it("returns 404 JSON for non-existent /api/* routes without swallowing into SPA index.html", async () => {
    app = createApp({ ttsService: dummyService }, { serveStatic: true, webDistDir: tempDir });

    const response = await app.inject({
      method: "GET",
      url: "/api/non-existent-endpoint",
    });

    expect(response.statusCode).toBe(404);
    expect(response.headers["content-type"]).toContain("application/json");
    expect(response.json()).toEqual({
      error: {
        code: "NOT_FOUND",
        message: "Route GET:/api/non-existent-endpoint not found",
      },
    });
  });

  it("returns 404 JSON for non-existent /v1/* routes without swallowing into SPA index.html", async () => {
    app = createApp({ ttsService: dummyService }, { serveStatic: true, webDistDir: tempDir });

    const response = await app.inject({
      method: "POST",
      url: "/v1/non-existent-endpoint",
    });

    expect(response.statusCode).toBe(404);
    expect(response.headers["content-type"]).toContain("application/json");
    expect(response.json()).toEqual({
      error: {
        code: "NOT_FOUND",
        message: "Route POST:/v1/non-existent-endpoint not found",
      },
    });
  });

  it("gracefully degrades to API-only mode when static directory does not exist", async () => {
    const nonExistentDir = path.join(tempDir, "does-not-exist");

    app = createApp(
      { ttsService: dummyService },
      { serveStatic: true, webDistDir: nonExistentDir },
    );

    // API remains functional
    const healthRes = await app.inject({
      method: "GET",
      url: "/api/health",
    });
    expect(healthRes.statusCode).toBe(200);
    expect(healthRes.json()).toEqual({ status: "ok" });

    // Root route returns 404 rather than crashing
    const rootRes = await app.inject({
      method: "GET",
      url: "/",
    });
    expect(rootRes.statusCode).toBe(404);
  });

  it("gracefully degrades when static directory exists but index.html is missing", async () => {
    fs.rmSync(path.join(tempDir, "index.html"));

    app = createApp({ ttsService: dummyService }, { serveStatic: true, webDistDir: tempDir });

    // API remains functional
    const healthRes = await app.inject({
      method: "GET",
      url: "/api/health",
    });
    expect(healthRes.statusCode).toBe(200);
    expect(healthRes.json()).toEqual({ status: "ok" });

    const rootRes = await app.inject({
      method: "GET",
      url: "/",
    });
    expect(rootRes.statusCode).toBe(404);
  });

  it("honors WEB_DIST_DIR environment variable when webDistDir option is omitted", async () => {
    const originalEnv = process.env["WEB_DIST_DIR"];
    try {
      process.env["WEB_DIST_DIR"] = tempDir;

      app = createApp({ ttsService: dummyService }, { serveStatic: true });

      const response = await app.inject({
        method: "GET",
        url: "/",
      });

      expect(response.statusCode).toBe(200);
      expect(response.body).toContain("EdgeTTS Workbench");
    } finally {
      if (originalEnv !== undefined) {
        process.env["WEB_DIST_DIR"] = originalEnv;
      } else {
        delete process.env["WEB_DIST_DIR"];
      }
    }
  });

  it("disables static hosting when serveStatic is explicitly false", async () => {
    app = createApp({ ttsService: dummyService }, { serveStatic: false, webDistDir: tempDir });

    const response = await app.inject({
      method: "GET",
      url: "/",
    });

    expect(response.statusCode).toBe(404);
  });

  it("integration: static WebUI root and assets remain public (200) without Authorization when API key authentication is enabled", async () => {
    app = createApp(
      { ttsService: dummyService },
      {
        webDistDir: tempDir,
        serveStatic: true,
        apiKey: "production-test-key-1234567890",
      },
    );

    // Root index.html is served without auth
    const rootRes = await app.inject({
      method: "GET",
      url: "/",
    });
    expect(rootRes.statusCode).toBe(200);
    expect(rootRes.headers["content-type"]).toContain("text/html");
    expect(rootRes.body).toContain("EdgeTTS Workbench");

    // Static asset is served without auth
    const assetRes = await app.inject({
      method: "GET",
      url: "/assets/index-test1234.js",
    });
    expect(assetRes.statusCode).toBe(200);
    expect(assetRes.body).toContain("console.log('edgetts bundle');");

    // Protected API endpoint /api/voices still requires auth
    const voicesRes = await app.inject({
      method: "GET",
      url: "/api/voices",
    });
    expect(voicesRes.statusCode).toBe(401);
  });
});

describe("Deterministic static hosting enablement contract matrix", () => {
  const originalEnv = { ...process.env };
  const dummyService = new DummyTtsService();
  let tempDir: string;
  let app: FastifyInstance | undefined;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "edgetts-matrix-test-"));
    fs.writeFileSync(path.join(tempDir, "index.html"), "<html><body>Matrix Test</body></html>");
  });

  afterEach(async () => {
    if (app) {
      await app.close();
      app = undefined;
    }
    if (fs.existsSync(tempDir)) {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
    // Restore environment exactly
    for (const key of Object.keys(process.env)) {
      if (!(key in originalEnv)) {
        delete process.env[key];
      }
    }
    for (const [key, value] of Object.entries(originalEnv)) {
      process.env[key] = value;
    }
  });

  it("serveStatic true enables static hosting", () => {
    delete process.env["SERVE_STATIC"];
    process.env["NODE_ENV"] = "development";
    expect(shouldEnableStaticHosting({ serveStatic: true })).toBe(true);
  });

  it("serveStatic false disables static hosting even if SERVE_STATIC=true or NODE_ENV=production", () => {
    process.env["SERVE_STATIC"] = "true";
    process.env["NODE_ENV"] = "production";
    expect(shouldEnableStaticHosting({ serveStatic: false })).toBe(false);
  });

  it("SERVE_STATIC true enables static hosting when option is omitted", () => {
    process.env["SERVE_STATIC"] = "true";
    process.env["NODE_ENV"] = "development";
    expect(shouldEnableStaticHosting()).toBe(true);
  });

  it("SERVE_STATIC false disables static hosting even if NODE_ENV=production", () => {
    process.env["SERVE_STATIC"] = "false";
    process.env["NODE_ENV"] = "production";
    expect(shouldEnableStaticHosting()).toBe(false);
  });

  it("NODE_ENV production enables static hosting when SERVE_STATIC is unset", () => {
    delete process.env["SERVE_STATIC"];
    process.env["NODE_ENV"] = "production";
    expect(shouldEnableStaticHosting()).toBe(true);
  });

  it("NODE_ENV development disables static hosting when SERVE_STATIC is unset", () => {
    delete process.env["SERVE_STATIC"];
    process.env["NODE_ENV"] = "development";
    expect(shouldEnableStaticHosting()).toBe(false);
  });

  it("NODE_ENV test disables static hosting when SERVE_STATIC is unset", () => {
    delete process.env["SERVE_STATIC"];
    process.env["NODE_ENV"] = "test";
    expect(shouldEnableStaticHosting()).toBe(false);
  });

  it("NODE_ENV undefined disables static hosting even when dist directory exists", () => {
    delete process.env["SERVE_STATIC"];
    delete process.env["NODE_ENV"];
    expect(shouldEnableStaticHosting({ webDistDir: tempDir })).toBe(false);
  });

  it("NODE_ENV empty string disables static hosting even when dist directory exists", () => {
    delete process.env["SERVE_STATIC"];
    process.env["NODE_ENV"] = "";
    expect(shouldEnableStaticHosting({ webDistDir: tempDir })).toBe(false);
  });

  it("integration: unset NODE_ENV keeps static hosting disabled by default and returns 404 at root", async () => {
    delete process.env["SERVE_STATIC"];
    delete process.env["NODE_ENV"];

    app = createApp(
      { ttsService: dummyService },
      { webDistDir: tempDir }, // directory exists, but serveStatic not explicitly specified
    );

    const response = await app.inject({
      method: "GET",
      url: "/",
    });

    expect(response.statusCode).toBe(404);

    // API remains fully operational
    const healthRes = await app.inject({
      method: "GET",
      url: "/api/health",
    });
    expect(healthRes.statusCode).toBe(200);
    expect(healthRes.json()).toEqual({ status: "ok" });
  });
});
