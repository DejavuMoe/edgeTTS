import { HttpsProxyAgent } from "https-proxy-agent";

/** Both Edge endpoints are TLS; HTTP_PROXY is a fallback for HTTPS_PROXY. */
export function proxyForUrl(target: string): string | undefined {
  const url = new URL(target);
  const env = (name: string) => process.env[name.toLowerCase()] || process.env[name] || "";
  const port = url.port || (url.protocol === "https:" || url.protocol === "wss:" ? "443" : "80");
  const bypass = env("NO_PROXY")
    .toLowerCase()
    .split(/[\s,]+/)
    .some((entry) => {
      if (entry === "*") return true;
      if (!entry) return false;
      const match = /^(.*):(\d+)$/.exec(entry);
      if (match && match[2] !== port) return false;
      const host = match ? match[1]! : entry;
      if (host.startsWith("*.")) return url.hostname.endsWith(host.slice(1));
      if (host.startsWith(".")) return url.hostname.endsWith(host);
      return url.hostname === host;
    });
  if (bypass) return undefined;
  const value = env("HTTPS_PROXY") || env("HTTP_PROXY");
  if (!value) return undefined;
  try {
    const proxy = new URL(value);
    if (!["http:", "https:"].includes(proxy.protocol)) throw new Error();
    return proxy.href;
  } catch {
    // Never include a proxy URL: it can contain credentials.
    throw new Error("Invalid proxy configuration: use an http:// or https:// URL");
  }
}

export function createProxyAgent(target: string, signal: AbortSignal) {
  const proxy = proxyForUrl(target);
  return proxy ? new HttpsProxyAgent(proxy, { signal }) : undefined;
}
