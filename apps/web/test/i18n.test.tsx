import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { App } from "../src/App.js";
import {
  LANGUAGE_OPTIONS,
  UI_LOCALE_KEY,
  loadUiLocale,
  messages,
  translate,
  type MessageKey,
} from "../src/i18n.js";
import { formatGeneratingStatusText } from "../src/lib/synthesis-telemetry.js";
import {
  createCompletedResultMeta,
  formatResultMetadataDisplay,
} from "../src/lib/result-metadata.js";

const voices = [
  { id: "ja-JP-NanamiNeural", displayName: "Nanami", locale: "ja-JP", gender: "Female" },
];

beforeEach(() => {
  localStorage.clear();
  vi.stubGlobal(
    "fetch",
    vi.fn(
      async (url: string) =>
        new Response(JSON.stringify(url === "/api/health" ? { status: "ok" } : { voices })),
    ),
  );
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

function switchLanguage(label: string) {
  fireEvent.click(document.querySelector(".language-control [role=combobox]")!);
  fireEvent.click(screen.getByRole("option", { name: label }));
}

describe("workbench localization", () => {
  it.each(LANGUAGE_OPTIONS)(
    "keeps every translation and interpolation complete: $value",
    ({ value }) => {
      for (const key of Object.keys(messages["zh-CN"]) as MessageKey[]) {
        expect(messages[value][key].trim()).not.toBe("");
        expect(messages[value][key].match(/\{\w+\}/g)?.sort() ?? []).toEqual(
          key.match(/\{\w+\}/g)?.sort() ?? [],
        );
      }
    },
  );

  it("switches all four languages, persists the choice, and preserves editor, voice and search state", async () => {
    const { unmount } = render(<App />);
    await screen.findByRole("option", { name: /Nanami/ });
    fireEvent.change(screen.getByRole("textbox"), { target: { value: "private draft" } });
    fireEvent.change(screen.getByRole("searchbox"), { target: { value: "Nanami" } });
    for (const { value, label } of LANGUAGE_OPTIONS) {
      switchLanguage(label);
      expect(document.documentElement.lang).toBe(value);
      expect(screen.getByRole("button", { name: translate("合成语音", value) })).toBeDefined();
      expect(screen.getByRole("textbox").getAttribute("placeholder")).toBe(
        translate("在此输入需要合成为语音的文本内容...", value),
      );
      expect((screen.getByRole("textbox") as HTMLTextAreaElement).value).toBe("private draft");
      expect((screen.getByRole("searchbox") as HTMLInputElement).value).toBe("Nanami");
      expect(screen.getByLabelText(translate("当前声音详情", value)).textContent).toContain(
        "ja-JP-NanamiNeural",
      );
      expect(localStorage.getItem(UI_LOCALE_KEY)).toBe(value);
      expect(document.querySelector("select")).toBeNull();
    }
    expect(fetch).toHaveBeenCalledTimes(2);
    unmount();
    await act(async () => {
      render(<App />);
    });
    expect(screen.getByRole("button", { name: "音声を合成" })).toBeDefined();
    expect((screen.getByRole("textbox") as HTMLTextAreaElement).value).toBe("");
  });

  it("translates existing authentication errors without retrying requests or retaining API keys", async () => {
    vi.mocked(fetch).mockImplementation(
      async (url) =>
        new Response(JSON.stringify({ status: "ok" }), {
          status: url === "/api/health" ? 200 : 401,
        }),
    );
    render(<App />);
    await screen.findByText("API 需要认证");
    fireEvent.change(screen.getByLabelText("API Key"), { target: { value: "short" } });
    fireEvent.click(screen.getByRole("button", { name: "解锁" }));
    expect(screen.getByRole("alert").textContent).toBe("API Key 格式无效");
    switchLanguage("English");
    expect(screen.getByRole("alert").textContent).toBe("Invalid API Key format");
    expect(screen.getByRole("button", { name: "Unlock" })).toBeDefined();
    expect(fetch).toHaveBeenCalledTimes(2);
    expect(localStorage.getItem(UI_LOCALE_KEY)).toBe("en");
  });

  it("localizes imported-file errors and supports searching localized gender", async () => {
    render(<App />);
    await screen.findByRole("option", { name: /Nanami/ });
    switchLanguage("日本語");
    fireEvent.change(screen.getByRole("searchbox"), { target: { value: "女性" } });
    expect(screen.getByRole("listbox", { name: "音声を選択 (1)" })).toBeDefined();
    fireEvent.change(document.querySelector('input[type="file"]')!, {
      target: { files: [new File([], "invalid.pdf")] },
    });
    await waitFor(() =>
      expect(screen.getByRole("alert").textContent).toBe("UTF-8 の TXT ファイルのみ対応しています"),
    );
    switchLanguage("English");
    expect(screen.getByRole("alert").textContent).toBe("Only UTF-8 TXT files are supported");
  });

  it("renders progress and completed metadata in the selected language", () => {
    const meta = createCompletedResultMeta({
      voiceId: "voice",
      voiceDisplayName: "Voice",
      quality: "high",
      speed: 1,
      pitchSemitones: 2,
      volume: 0.5,
      segmentCount: 2,
    });
    for (const { value } of LANGUAGE_OPTIONS) {
      expect(
        formatGeneratingStatusText(
          { phase: "requesting", segmentCount: null, bytesReceived: 0 },
          value,
        ),
      ).toBe(translate("正在等待语音服务…", value));
      expect(
        formatGeneratingStatusText(
          { phase: "streaming", segmentCount: 2, bytesReceived: 1024 },
          value,
        ),
      ).toContain(translate("共 {count} 段", value, { count: 2 }));
      const result = formatResultMetadataDisplay(meta, value);
      expect(result).toContain(translate("高品质", value));
      expect(result).toContain(translate("{value}半音", value, { value: "+2" }));
      expect(result).toContain(translate("{value}%音量", value, { value: 50 }));
    }
  });

  it("updates an existing player and metadata without replacing the audio or download", async () => {
    vi.stubGlobal("MediaSource", undefined);
    URL.createObjectURL = vi.fn(() => "blob:localized-audio");
    URL.revokeObjectURL = vi.fn();
    vi.spyOn(HTMLMediaElement.prototype, "play").mockResolvedValue();
    vi.mocked(fetch).mockImplementation(async (url) =>
      url === "/api/speech"
        ? new Response(new Uint8Array([1, 2, 3]))
        : new Response(JSON.stringify(url === "/api/health" ? { status: "ok" } : { voices })),
    );
    render(<App />);
    await screen.findByRole("option", { name: /Nanami/ });
    fireEvent.change(screen.getByRole("textbox"), { target: { value: "private draft" } });
    fireEvent.click(screen.getByRole("button", { name: "合成语音" }));
    const link = await screen.findByRole("link", { name: "下载合成音频" });
    const filename = link.getAttribute("download");
    const audio = document.querySelector("audio");
    for (const { value, label } of LANGUAGE_OPTIONS) {
      switchLanguage(label);
      expect(screen.getByRole("button", { name: translate("播放", value) })).toBeDefined();
      expect(screen.getByRole("button", { name: translate("静音", value) })).toBeDefined();
      expect(screen.getByLabelText(translate("音频时间进度条", value))).toBeDefined();
      expect(
        screen
          .getByRole("link", { name: translate("下载合成音频", value) })
          .getAttribute("download"),
      ).toBe(filename);
      expect(screen.getByLabelText(translate("音频生成信息", value)).textContent).toContain(
        translate("标准", value),
      );
      expect(document.querySelector("audio")).toBe(audio);
    }
    expect(fetch).toHaveBeenCalledTimes(3);
    expect(URL.revokeObjectURL).not.toHaveBeenCalled();
  });

  it("falls back safely for invalid or blocked preference storage", async () => {
    localStorage.setItem(UI_LOCALE_KEY, "unsupported");
    expect(loadUiLocale()).toBe("zh-CN");
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new Error("blocked");
    });
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("blocked");
    });
    expect(loadUiLocale()).toBe("zh-CN");
    await act(async () => {
      render(<App />);
    });
    switchLanguage("English");
    expect(document.documentElement.lang).toBe("en");
  });
});
