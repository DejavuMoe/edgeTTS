// @vitest-environment node
import { randomBytes } from "node:crypto";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { brotliDecompressSync, gunzipSync } from "node:zlib";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { PRECOMPRESS_MIN_BYTES, precompressDirectory } from "../../vite-precompress.js";

describe("precompressDirectory", () => {
  let dir: string;

  beforeEach(async () => {
    dir = await mkdtemp(path.join(tmpdir(), "edgetts-precompress-"));
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it("writes br and gz siblings that decode to the original text files", async () => {
    const script = "export const voices = ['zh-CN-XiaoxiaoNeural'];\n".repeat(80);
    const html = `<!doctype html><title>edgeTTS</title>${"<p>workbench</p>".repeat(100)}`;
    await mkdir(path.join(dir, "assets"));
    await writeFile(path.join(dir, "assets", "index-abc.js"), script);
    await writeFile(path.join(dir, "index.html"), html);

    const written = await precompressDirectory(dir);

    expect(written).toEqual([
      "assets/index-abc.js.br",
      "assets/index-abc.js.gz",
      "index.html.br",
      "index.html.gz",
    ]);
    const br = await readFile(path.join(dir, "assets", "index-abc.js.br"));
    const gz = await readFile(path.join(dir, "index.html.gz"));
    expect(brotliDecompressSync(br).toString()).toBe(script);
    expect(gunzipSync(gz).toString()).toBe(html);
  });

  it("skips small files, binary formats and output that would not shrink", async () => {
    await writeFile(path.join(dir, "tiny.css"), "a".repeat(PRECOMPRESS_MIN_BYTES - 1));
    await writeFile(path.join(dir, "icon.png"), "png ".repeat(1000));
    // Random bytes do not compress, so a sibling would only cost disk and a negotiation.
    await writeFile(path.join(dir, "noise.js"), randomBytes(4096));

    expect(await precompressDirectory(dir)).toEqual([]);
  });
});
