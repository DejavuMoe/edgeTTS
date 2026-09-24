/** Environment variables as read at startup; `process.env` satisfies this shape. */
export type Environment = Readonly<Record<string, string | undefined>>;

export function parseStrictInteger(
  value: unknown,
  varName: string,
  min: number,
  max: number,
  defaultValue: number,
): number {
  if (value === undefined || value === null) {
    return defaultValue;
  }

  let str: string;
  if (typeof value === "number") {
    if (!Number.isInteger(value)) {
      throw new RangeError(`${varName} must be an integer (got ${value})`);
    }
    if (value < min || value > max) {
      throw new RangeError(`${varName} must be between ${min} and ${max} (got ${value})`);
    }
    return value;
  } else if (typeof value === "string") {
    str = value;
  } else {
    throw new TypeError(`${varName} must be an integer string or number`);
  }

  if (str.trim().length === 0) {
    throw new RangeError(`${varName} must not be empty or whitespace only`);
  }

  if (!/^\d+$/.test(str) || str !== str.trim()) {
    throw new RangeError(`${varName} must be an integer`);
  }

  const num = Number(str);
  if (!Number.isSafeInteger(num)) {
    throw new RangeError(`${varName} must be a safe integer`);
  }

  if (num < min || num > max) {
    throw new RangeError(`${varName} must be between ${min} and ${max} (got ${num})`);
  }

  return num;
}

/** Like {@link parseStrictInteger}, but an unset variable stays unset so the owning layer's default applies. */
export function parseOptionalInteger(
  value: string | undefined,
  varName: string,
  min: number,
  max: number,
): number | undefined {
  return value === undefined ? undefined : parseStrictInteger(value, varName, min, max, min);
}

export function parseBooleanFlag(value: string, varName: string): boolean {
  if (value === "true") return true;
  if (value === "false") return false;
  throw new RangeError(`${varName} must be either 'true' or 'false'`);
}

/** Trusted reverse proxies: none, all, a hop count, or explicit addresses/CIDRs. */
export type TrustProxySetting = boolean | number | readonly string[];

export const MAX_TRUST_PROXY_HOPS = 16;

export function parseTrustProxy(value: string | undefined): TrustProxySetting {
  if (value === undefined) return false;
  if (value === "true" || value === "false") return parseBooleanFlag(value, "TRUST_PROXY");
  if (/^\d+$/.test(value)) {
    return parseStrictInteger(value, "TRUST_PROXY", 1, MAX_TRUST_PROXY_HOPS, 1);
  }

  const addresses = value.split(",").map((entry) => entry.trim());
  if (addresses.some((entry) => entry.length === 0 || /\s/.test(entry))) {
    throw new RangeError(
      "TRUST_PROXY must be 'true', 'false', a hop count, or a comma-separated list of addresses",
    );
  }
  // Address syntax is validated by Fastify (proxy-addr) when the app is created.
  return addresses;
}
