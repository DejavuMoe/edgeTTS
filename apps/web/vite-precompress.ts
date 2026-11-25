import { readdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import { brotliCompress, constants, gzip } from "node:zlib";
import type { Plugin } from "vite";

const brotliAsync = promisify(brotliCompress);
const gzipAsync = promisify(gzip);

/** Text formats; images, icons and fonts are compressed already. */
const COMPRESSIBLE_EXTENSIONS = new Set([
  ".html",
  ".js",
  ".mjs",
  ".css",
  ".svg",
  ".json",
  ".webmanifest",
  ".txt",
]);

/** Below this a compressed copy saves less than it costs to keep and negotiate. */
export const PRECOMPRESS_MIN_BYTES = 1024;

/** A compressed copy is kept only when it is at most this fraction of the original. */
const MAX_COMPRESSED_RATIO = 0.9;

/**
 * Writes `.br` and `.gz` siblings next to every compressible file under `dir`, at maximum
 * compression since this runs once per build. The server picks the sibling a client accepts.
 * Returns the written paths relative to `dir`, sorted.
 */
export async function precompressDirectory(dir: string): Promise<string[]> {
  const written: string[] = [];
  const entries = await readdir(dir, { recursive: true, withFileTypes: true });
  await Promise.all(
    entries.map(async (entry) => {
      const file = path.join(entry.parentPath, entry.name);
      if (!entry.isFile() || !COMPRESSIBLE_EXTENSIONS.has(path.extname(file))) return;
      const source = await readFile(file);
      if (source.length < PRECOMPRESS_MIN_BYTES) return;
      const [br, gzipped] = await Promise.all([
        brotliAsync(source, {
          params: {
            [constants.BROTLI_PARAM_MODE]: constants.BROTLI_MODE_TEXT,
            [constants.BROTLI_PARAM_QUALITY]: constants.BROTLI_MAX_QUALITY,
            [constants.BROTLI_PARAM_SIZE_HINT]: source.length,
          },
        }),
        gzipAsync(source, { level: constants.Z_BEST_COMPRESSION }),
      ]);
      for (const [extension, data] of [
        [".br", br],
        [".gz", gzipped],
      ] as const) {
        if (data.length > source.length * MAX_COMPRESSED_RATIO) continue;
        await writeFile(file + extension, data);
        written.push(path.relative(dir, file + extension).replace(/\\/g, "/"));
      }
    }),
  );
  return written.sort();
}

/** Precompresses the finished production build in its output directory. */
export function precompress(): Plugin {
  let outDir = "";
  return {
    name: "edgetts:precompress",
    apply: "build",
    configResolved(config) {
      outDir = path.resolve(config.root, config.build.outDir);
    },
    async closeBundle() {
      await precompressDirectory(outDir);
    },
  };
}
