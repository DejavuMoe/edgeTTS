import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import fastifyStatic from "@fastify/static";
import type { ApiError } from "@edgetts/shared";

export interface StaticHostingOptions {
  readonly webDistDir?: string | undefined;
  readonly serveStatic?: boolean | undefined;
}

export function resolveWebDistDir(customDir?: string): string {
  if (customDir) {
    return path.resolve(customDir);
  }
  const envDir = process.env["WEB_DIST_DIR"];
  if (envDir) {
    return path.resolve(envDir);
  }
  return fileURLToPath(new URL("../../web/dist", import.meta.url));
}

export function shouldEnableStaticHosting(options?: StaticHostingOptions): boolean {
  if (options?.serveStatic !== undefined) {
    return options.serveStatic;
  }
  const envServeStatic = process.env["SERVE_STATIC"];
  if (envServeStatic === "true") {
    return true;
  }
  if (envServeStatic === "false") {
    return false;
  }
  if (process.env["NODE_ENV"] === "production") {
    return true;
  }
  return false;
}

export function registerStaticHosting(
  app: FastifyInstance,
  options?: StaticHostingOptions,
): boolean {
  if (!shouldEnableStaticHosting(options)) {
    return false;
  }

  const webDistDir = resolveWebDistDir(options?.webDistDir);
  const hasWebDist = fs.existsSync(webDistDir) && fs.statSync(webDistDir).isDirectory();
  const hasIndexHtml = hasWebDist && fs.existsSync(path.join(webDistDir, "index.html"));

  if (!hasWebDist || !hasIndexHtml) {
    app.log.warn(
      { webDistDir, hasWebDist, hasIndexHtml },
      "Static web hosting enabled, but web dist directory or index.html was not found. Running in API-only mode.",
    );
    return false;
  }

  void app.register(fastifyStatic, {
    root: webDistDir,
    prefix: "/",
    wildcard: true,
    setHeaders(reply: FastifyReply, filePath: string): void {
      const normalized = filePath.replace(/\\/g, "/");
      if (normalized.includes("/assets/")) {
        reply.header("Cache-Control", "public, max-age=31536000, immutable");
      } else if (normalized.endsWith("index.html")) {
        reply.header("Cache-Control", "no-cache");
      }
    },
  });

  app.setNotFoundHandler((request: FastifyRequest, reply: FastifyReply) => {
    const pathname = new URL(request.url, "http://localhost").pathname;
    const isApi =
      pathname.startsWith("/api/") ||
      pathname.startsWith("/v1/") ||
      pathname === "/api" ||
      pathname === "/v1" ||
      pathname === "/health" ||
      pathname.startsWith("/health/");
    const hasExtension = path.extname(pathname) !== "";

    if (!isApi && !hasExtension && (request.method === "GET" || request.method === "HEAD")) {
      reply.header("Cache-Control", "no-cache");
      return reply.sendFile("index.html");
    }

    if (isApi) {
      const apiError: ApiError = {
        error: {
          code: "NOT_FOUND",
          message: `Route ${request.method}:${pathname} not found`,
        },
      };
      return reply.code(404).type("application/json").send(apiError);
    }

    return reply.code(404).send({
      error: "Not Found",
      message: `Route ${request.method}:${pathname} not found`,
      statusCode: 404,
    });
  });

  return true;
}
