import { NativeEdgeClient } from "../src/client.js";
import { afterEach, describe, expect, it, vi } from "vitest";

// Browser-captured vector: https://github.com/rany2/edge-tts/pull/492
const CAPTURE_TIME_MS = 1_791_888_000_000;
const CAPTURE_TOKEN =
  "492D7694A183A45E-56E821F95D4579C5B7C7E33DC7303FF379EC36D510213555BBBB9EB17EF15876";

afterEach(() => vi.restoreAllMocks());

describe("native Edge authentication", () => {
  it("sends the captured v2 token with a matching protocol version", async () => {
    vi.spyOn(Date, "now").mockReturnValue(CAPTURE_TIME_MS);

    const url = new URL(await NativeEdgeClient.getSynthUrl());

    expect(url.searchParams.get("Sec-MS-GEC-Version")).toMatch(/^2-\d+\.\d+\.\d+\.\d+$/);
    expect(url.searchParams.get("Sec-MS-GEC")).toBe(CAPTURE_TOKEN);
    expect(url.protocol).toBe("wss:");
    expect(url.hostname).toBe("speech.platform.bing.com");
    expect(url.pathname).toBe("/consumer/speech/synthesize/readaloud/edge/v1");
    expect(url.searchParams.get("TrustedClientToken")).toBeTruthy();
    expect(url.searchParams.get("ConnectionId")).toBeTruthy();
  });

  it("keeps a token within its five-minute window and rotates at the boundary", async () => {
    const now = vi.spyOn(Date, "now").mockReturnValue(CAPTURE_TIME_MS + 299_999);
    const withinWindow = new URL(await NativeEdgeClient.getSynthUrl());
    expect(withinWindow.searchParams.get("Sec-MS-GEC")).toBe(CAPTURE_TOKEN);

    now.mockReturnValue(CAPTURE_TIME_MS + 300_000);
    const nextWindow = new URL(await NativeEdgeClient.getSynthUrl());
    expect(nextWindow.searchParams.get("Sec-MS-GEC")).toMatch(/^[A-F0-9]{16}-[A-F0-9]{64}$/);
    expect(nextWindow.searchParams.get("Sec-MS-GEC")).not.toBe(CAPTURE_TOKEN);
  });
});
