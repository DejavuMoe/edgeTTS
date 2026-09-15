import React from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { App } from "../src/App.js";

const voices = {
  voices: [{ id: "en-US-AriaNeural", displayName: "Aria", locale: "en-US", gender: "Female" }],
};

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

beforeEach(() => {
  localStorage.clear();
  URL.createObjectURL = vi.fn(() => "blob:audit");
  URL.revokeObjectURL = vi.fn();
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("audit regressions", () => {
  it("does not let a completed import overwrite a newer manual edit", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) => (url === "/api/health" ? json({ status: "ok" }) : json(voices))),
    );
    render(<App />);

    let resolve!: (value: ArrayBuffer) => void;
    const pending = new Promise<ArrayBuffer>((done) => {
      resolve = done;
    });
    const file = new File([], "pending.txt", { type: "text/plain" });
    Object.defineProperty(file, "arrayBuffer", { value: () => pending });

    fireEvent.change(document.querySelector('input[type="file"]')!, { target: { files: [file] } });
    const textarea = screen.getByLabelText("文本内容") as HTMLTextAreaElement;
    fireEvent.change(textarea, { target: { value: "newer manual edit" } });
    resolve(new TextEncoder().encode("older imported text").buffer);

    await waitFor(() => expect(textarea.value).toBe("newer manual edit"));
  });

  it("loads voices even while the independent health probe is pending", async () => {
    const fetchMock = vi.fn((url: string) => {
      if (url === "/api/health") return new Promise<Response>(() => {});
      return Promise.resolve(json(voices));
    });
    vi.stubGlobal("fetch", fetchMock);
    render(<App />);

    await screen.findByText("Aria");
    expect(fetchMock).toHaveBeenCalledWith("/api/voices", expect.any(Object));
  });

  it("attempts playback after the generated audio element is mounted", async () => {
    vi.stubGlobal("MediaSource", undefined);
    const play = vi.spyOn(HTMLMediaElement.prototype, "play").mockResolvedValue();
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) => {
        if (url === "/api/health") return json({ status: "ok" });
        if (url === "/api/voices") return json(voices);
        return new Response(new Uint8Array([1, 2, 3]), { status: 200 });
      }),
    );
    render(<App />);

    const textarea = screen.getByLabelText("文本内容");
    fireEvent.change(textarea, { target: { value: "example" } });
    fireEvent.click(await screen.findByRole("button", { name: "合成语音" }));

    await screen.findByLabelText("下载合成音频");
    await waitFor(() => expect(play).toHaveBeenCalledTimes(1));
  });
});
