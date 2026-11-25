import { brotliDecompressSync, gunzipSync } from "node:zlib";
import { describe, expect, it } from "vitest";
import { EncodedJsonCache, matchesIfNoneMatch, negotiateEncoding } from "../src/encoded-json.js";

describe("negotiateEncoding", () => {
  it.each([
    [undefined, null],
    ["", null],
    ["identity", null],
    ["gzip, deflate, br", "br"],
    ["gzip", "gzip"],
    ["br;q=0, gzip", "gzip"],
    ["br;q=0.5, gzip;q=0.8", "gzip"],
    ["BR", "br"],
    ["*", "br"],
    ["*;q=0, gzip", "gzip"],
    ["gzip;q=0, br;q=0", null],
    ["br;q=abc", null],
  ] as const)("chooses %j as %j", (header, expected) => {
    expect(negotiateEncoding(header)).toBe(expected);
  });
});

describe("matchesIfNoneMatch", () => {
  const etag = 'W/"abc"';

  it.each([
    [undefined, false],
    ['"abc"', true],
    ['W/"abc"', true],
    ['"other", W/"abc"', true],
    ["*", true],
    ['"abcd"', false],
  ] as const)("matches %j: %j", (header, expected) => {
    expect(matchesIfNoneMatch(header, etag)).toBe(expected);
  });
});

describe("EncodedJsonCache", () => {
  it("encodes a document once and decodes to the same JSON in every encoding", async () => {
    const cache = new EncodedJsonCache();
    const document = { voices: [{ id: "zh-CN-XiaoxiaoNeural", locale: "zh-CN" }] };

    const first = await cache.encode(document);
    const again = await cache.encode({ voices: [{ id: "zh-CN-XiaoxiaoNeural", locale: "zh-CN" }] });

    expect(again).toBe(first);
    expect(first.etag).toMatch(/^W\/"[\w-]{27}"$/);
    expect(first.identity).toBe(JSON.stringify(document));
    expect(brotliDecompressSync(first.br).toString()).toBe(first.identity);
    expect(gunzipSync(first.gzip).toString()).toBe(first.identity);
  });

  it("re-encodes with a new ETag when the document changes", async () => {
    const cache = new EncodedJsonCache();
    const before = await cache.encode({ voices: [] });
    const after = await cache.encode({ voices: [{ id: "en-US-JennyNeural" }] });

    expect(after.etag).not.toBe(before.etag);
    expect(after.identity).toBe('{"voices":[{"id":"en-US-JennyNeural"}]}');
  });
});
