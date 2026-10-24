import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { proxyForUrl } from "../src/proxy.js";

describe("upstream proxy environment", () => {
  beforeEach(() => {
    for (const name of ["HTTPS_PROXY", "HTTP_PROXY", "NO_PROXY"]) {
      vi.stubEnv(name, "");
      vi.stubEnv(name.toLowerCase(), "");
    }
  });
  afterEach(() => vi.unstubAllEnvs());

  it("uses the same proxy for HTTPS discovery and WSS synthesis, with HTTP fallback", () => {
    vi.stubEnv("HTTP_PROXY", "http://fallback.test:8080");
    for (const scheme of ["https", "wss"]) {
      expect(proxyForUrl(`${scheme}://speech.platform.bing.com/`)).toBe(
        "http://fallback.test:8080/",
      );
    }
    vi.stubEnv("HTTPS_PROXY", "https://preferred.test");
    expect(proxyForUrl("wss://speech.platform.bing.com")).toBe("https://preferred.test/");
    vi.stubEnv("https_proxy", "http://lowercase.test");
    expect(proxyForUrl("https://speech.platform.bing.com")).toBe("http://lowercase.test/");
  });

  it.each([
    ["*", "speech.platform.bing.com", true],
    ["speech.platform.bing.com", "speech.platform.bing.com", true],
    [".bing.com", "speech.platform.bing.com", true],
    ["*.bing.com", "speech.platform.bing.com", true],
    [".bing.com", "evilbing.com", false],
    ["bing.com", "speech.platform.bing.com", false],
    ["speech.platform.bing.com:443", "speech.platform.bing.com", true],
    ["speech.platform.bing.com:80", "speech.platform.bing.com", false],
    ["localhost, 127.0.0.1", "127.0.0.1", true],
    ["[::1]:443", "[::1]", true],
  ])("matches NO_PROXY=%s against %s", (bypass, host, direct) => {
    vi.stubEnv("HTTPS_PROXY", "http://proxy.test");
    vi.stubEnv("NO_PROXY", bypass);
    expect(proxyForUrl(`wss://${host}/`)).toBe(direct ? undefined : "http://proxy.test/");
  });

  it("gives lowercase no_proxy precedence and does not read unrelated ALL_PROXY", () => {
    vi.stubEnv("HTTPS_PROXY", "http://proxy.test");
    vi.stubEnv("NO_PROXY", "*");
    vi.stubEnv("no_proxy", "elsewhere.test");
    expect(proxyForUrl("https://example.com")).toBe("http://proxy.test/");
    vi.stubEnv("HTTPS_PROXY", "");
    vi.stubEnv("ALL_PROXY", "socks5://proxy.test");
    expect(proxyForUrl("https://example.com")).toBeUndefined();
  });

  it.each(["socks5://user:secret@proxy.test", "not a url", "http://user:secret@"])(
    "rejects unsupported or malformed configuration without exposing credentials",
    (value) => {
      vi.stubEnv("HTTPS_PROXY", value);
      expect(() => proxyForUrl("https://example.com")).toThrow(
        "Invalid proxy configuration: use an http:// or https:// URL",
      );
    },
  );
});
