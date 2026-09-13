import { describe, it, expect, afterEach } from "vitest";
import type { FastifyInstance } from "fastify";
import { buildApp } from "../src/app.js";

describe("GET /api/health", () => {
  let app: FastifyInstance | undefined;

  afterEach(async () => {
    if (app) {
      await app.close();
    }
  });

  it("should return HTTP 200 with status ok", async () => {
    app = buildApp();
    const response = await app.inject({
      method: "GET",
      url: "/api/health",
    });

    expect(response.statusCode).toBe(200);
    expect(response.headers["content-type"]).toContain("application/json");
    expect(response.json()).toEqual({ status: "ok" });
  });
});
