import React from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { App } from "../src/App.js";
import {
  StreamPlaybackController,
  type StreamPlaybackCallbacks,
} from "../src/audio/stream-controller.js";

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
  it.each(["playing", "paused", "cancelled", "unmounted"] as const)(
    "preserves playback state across quota fallback: %s",
    async (mode) => {
      vi.stubGlobal(
        "fetch",
        vi.fn(async (url: string) => {
          if (url === "/api/health") return json({ status: "ok" });
          if (url === "/api/voices") return json(voices);
          return new Response(null);
        }),
      );
      const play = vi.spyOn(HTMLMediaElement.prototype, "play").mockResolvedValue(undefined);
      let callbacks!: StreamPlaybackCallbacks;
      let finish!: () => void;
      vi.spyOn(StreamPlaybackController.prototype, "startStream").mockImplementation(
        async (_response, _signal, streamCallbacks) => {
          callbacks = streamCallbacks;
          await new Promise<void>((resolve) => {
            finish = resolve;
          });
        },
      );
      const view = render(<App />);
      await screen.findByRole("option", { name: /Aria/ });
      fireEvent.change(screen.getByLabelText("文本内容"), {
        target: { value: "quota regression" },
      });
      fireEvent.click(screen.getByRole("button", { name: "合成语音" }));
      await waitFor(() => expect(callbacks).toBeDefined());
      act(() => callbacks.onStreamReady("blob:preview"));
      const audio = document.querySelector("audio")!;
      audio.currentTime = 12.5;
      Object.defineProperty(audio, "paused", { value: mode === "paused", configurable: true });
      play.mockClear();
      act(() => {
        callbacks.onStreamReady("blob:complete");
        // The browser resets currentTime when the media resource changes.
        audio.currentTime = 0;
      });
      Object.defineProperty(audio, "currentSrc", { value: "blob:preview", configurable: true });
      fireEvent.loadedMetadata(audio);
      expect(audio.currentTime).toBe(0);
      expect(play).not.toHaveBeenCalled();
      if (mode === "cancelled") fireEvent.click(screen.getByRole("button", { name: "取消合成" }));
      if (mode === "unmounted") view.unmount();
      Object.defineProperty(audio, "currentSrc", { value: "blob:complete", configurable: true });
      fireEvent.loadedMetadata(audio);

      expect(audio.currentTime).toBe(mode === "cancelled" || mode === "unmounted" ? 0 : 12.5);
      expect(play).toHaveBeenCalledTimes(mode === "playing" ? 1 : 0);
      await act(async () => {
        finish();
      });
    },
  );

  it("allows leaving favorites-only after the catalog loses every favorite", async () => {
    let voiceRequests = 0;
    const replacement = {
      voices: [{ id: "en-US-GuyNeural", displayName: "Guy", locale: "en-US", gender: "Male" }],
    };
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) => {
        if (url === "/api/health") return json({ status: "ok" });
        if (url === "/api/voices") return json(++voiceRequests === 1 ? voices : replacement);
        return json({ error: { code: "UNAUTHORIZED", message: "Unauthorized" } }, 401);
      }),
    );
    render(<App />);
    await screen.findByRole("option", { name: /Aria/ });
    fireEvent.click(screen.getByRole("button", { name: "收藏当前声音" }));
    const favoritesOnly = screen.getByRole("checkbox", { name: "只看收藏" }) as HTMLInputElement;
    fireEvent.click(favoritesOnly);
    fireEvent.change(screen.getByLabelText("文本内容"), { target: { value: "example" } });
    fireEvent.click(screen.getByRole("button", { name: "合成语音" }));
    fireEvent.change(await screen.findByLabelText("API Key"), {
      target: { value: "repro-only-key-0001" },
    });
    fireEvent.click(screen.getByRole("button", { name: "解锁" }));

    await waitFor(() => expect(screen.queryByLabelText("API Key")).toBeNull());
    expect(favoritesOnly.checked).toBe(true);
    expect(screen.queryAllByRole("option")).toHaveLength(0);
    expect(favoritesOnly.disabled).toBe(false);
    fireEvent.click(favoritesOnly);
    expect(favoritesOnly.checked).toBe(false);
    expect(screen.getByRole("option", { name: /Guy/ })).toBeDefined();
    expect(favoritesOnly.disabled).toBe(true);
  });

  it("clears the active voice when reauthentication returns an empty catalog", async () => {
    let voiceRequests = 0;
    let speechRequests = 0;
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) => {
        if (url === "/api/health") return json({ status: "ok" });
        if (url === "/api/voices") return json(++voiceRequests === 1 ? voices : { voices: [] });
        speechRequests++;
        return json({ error: { code: "UNAUTHORIZED", message: "Unauthorized" } }, 401);
      }),
    );
    render(<App />);
    await screen.findByRole("option", { name: /Aria/ });
    const textarea = screen.getByLabelText("文本内容");
    fireEvent.change(textarea, { target: { value: "example" } });
    fireEvent.click(screen.getByRole("button", { name: "合成语音" }));
    fireEvent.change(await screen.findByLabelText("API Key"), {
      target: { value: "repro-only-key-0001" },
    });
    fireEvent.click(screen.getByRole("button", { name: "解锁" }));

    await waitFor(() => expect(screen.queryByLabelText("API Key")).toBeNull());
    expect(screen.queryAllByRole("option")).toHaveLength(0);
    expect(screen.queryByLabelText("当前声音详情")).toBeNull();
    expect(screen.getByRole("button", { name: "合成语音" }).hasAttribute("disabled")).toBe(true);
    fireEvent.keyDown(textarea, { key: "Enter", ctrlKey: true });
    expect(speechRequests).toBe(1);
  });

  it("does not let a completed import overwrite a newer manual edit", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) => (url === "/api/health" ? json({ status: "ok" }) : json(voices))),
    );
    render(<App />);
    await screen.findByRole("option", { name: /Aria/ });

    let resolve!: (value: ArrayBuffer) => void;
    const pending = new Promise<ArrayBuffer>((done) => {
      resolve = done;
    });
    const file = new File([], "pending.txt", { type: "text/plain" });
    Object.defineProperty(file, "arrayBuffer", { value: () => pending });

    const textarea = screen.getByLabelText("文本内容") as HTMLTextAreaElement;
    const generate = screen.getByRole("button", { name: "合成语音" });
    fireEvent.change(textarea, { target: { value: "original text" } });
    fireEvent.change(document.querySelector('input[type="file"]')!, { target: { files: [file] } });
    expect(generate.hasAttribute("disabled")).toBe(true);
    fireEvent.change(textarea, { target: { value: "newer manual edit" } });
    expect(generate.hasAttribute("disabled")).toBe(false);
    await act(async () => resolve(new TextEncoder().encode("older imported text").buffer));

    expect(textarea.value).toBe("newer manual edit");
    expect(generate.hasAttribute("disabled")).toBe(false);
  });

  it("loads voices even while the independent health probe is pending", async () => {
    const fetchMock = vi.fn((url: string) => {
      if (url === "/api/health") return new Promise<Response>(() => {});
      return Promise.resolve(json(voices));
    });
    vi.stubGlobal("fetch", fetchMock);
    render(<App />);

    await screen.findByRole("option", { name: /Aria/ });
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
