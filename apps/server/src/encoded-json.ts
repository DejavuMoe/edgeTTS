import { createHash } from "node:crypto";
import { promisify } from "node:util";
import { brotliCompress, constants, gzip } from "node:zlib";

const brotliAsync = promisify(brotliCompress);
const gzipAsync = promisify(gzip);

export type ContentEncoding = "br" | "gzip";

/** One JSON document, serialized once and kept in every encoding a client may ask for. */
export interface EncodedJson {
  /** A weak validator: the br, gzip and identity bytes all carry the same JSON. */
  readonly etag: string;
  readonly identity: string;
  readonly br: Buffer;
  readonly gzip: Buffer;
}

/**
 * Serializes and compresses a JSON document, reusing the previous result while the document is
 * unchanged. The voice catalog changes only when its cache refreshes, so compression runs once
 * per refresh instead of once per request, and off the event loop.
 */
export class EncodedJsonCache {
  private latest: { readonly etag: string; readonly encoded: Promise<EncodedJson> } | null = null;

  async encode(document: unknown): Promise<EncodedJson> {
    const identity = JSON.stringify(document);
    const etag = `W/"${createHash("sha256").update(identity).digest("base64url").slice(0, 27)}"`;
    if (this.latest?.etag === etag) return this.latest.encoded;

    const encoded = compress(identity, etag);
    this.latest = { etag, encoded };
    // A failed compression must not be served to every later request for the same document.
    encoded.catch(() => {
      if (this.latest?.encoded === encoded) this.latest = null;
    });
    return encoded;
  }
}

async function compress(identity: string, etag: string): Promise<EncodedJson> {
  const source = Buffer.from(identity, "utf8");
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
  return { etag, identity, br, gzip: gzipped };
}

/**
 * Picks the encoding to send for an Accept-Encoding header: brotli, then gzip, else identity.
 * Honors q-values, including q=0 refusals, and the `*` wildcard.
 */
export function negotiateEncoding(header: string | undefined): ContentEncoding | null {
  if (!header) return null;
  const weights = new Map<string, number>();
  for (const part of header.toLowerCase().split(",")) {
    const [token = "", ...params] = part.split(";").map((piece) => piece.trim());
    if (!token) continue;
    const q = params.find((param) => param.startsWith("q="));
    const weight = q === undefined ? 1 : Number(q.slice(2));
    weights.set(token, Number.isFinite(weight) ? weight : 0);
  }
  const weightOf = (encoding: ContentEncoding): number =>
    weights.get(encoding) ?? weights.get("*") ?? 0;
  const br = weightOf("br");
  const gzipped = weightOf("gzip");
  if (br > 0 && br >= gzipped) return "br";
  if (gzipped > 0) return "gzip";
  return null;
}

/** Whether an If-None-Match header names this ETag, using weak comparison as RFC 9110 asks. */
export function matchesIfNoneMatch(header: string | undefined, etag: string): boolean {
  if (!header) return false;
  const opaque = (tag: string) => tag.trim().replace(/^W\//, "");
  return header.split(",").some((tag) => tag.trim() === "*" || opaque(tag) === opaque(etag));
}
