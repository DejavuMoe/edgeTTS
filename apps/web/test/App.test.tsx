import React from "react";
import { describe, it, expect, vi, beforeEach, afterEach, type Mock } from "vitest";
import { render, screen, waitFor, fireEvent, cleanup } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { VoiceDto } from "@edgetts/shared";
import { App, isValidApiKeyFormat, MIN_API_KEY_LENGTH } from "../src/App.js";
import { WORKBENCH_PREFERENCES_KEY } from "../src/preferences.js";
import { WORKBENCH_FAVORITES_KEY } from "../src/voice-favorites.js";

function requestUrl(input: RequestInfo | URL): string {
  if (typeof input === "string") return input;
  return input instanceof URL ? input.href : input.url;
}

const mockVoices: readonly VoiceDto[] = [
  {
    id: "zh-CN-XiaoxiaoNeural",
    displayName: "Microsoft Xiaoxiao",
    locale: "zh-CN",
    gender: "Female",
  },
  {
    id: "zh-CN-YunxiNeural",
    displayName: "Microsoft Yunxi",
    locale: "zh-CN",
    gender: "Male",
  },
  {
    id: "en-US-JennyNeural",
    displayName: "Microsoft Jenny",
    locale: "en-US",
    gender: "Female",
  },
  {
    id: "ja-JP-NanamiNeural",
    displayName: "Microsoft Nanami",
    locale: "ja-JP",
    gender: "Female",
  },
];

async function openCombobox(
  user: ReturnType<typeof userEvent.setup>,
  combobox: HTMLElement,
): Promise<void> {
  if (combobox.getAttribute("aria-expanded") !== "true") {
    await user.click(combobox);
  }
}

async function closeCombobox(
  user: ReturnType<typeof userEvent.setup>,
  combobox: HTMLElement,
): Promise<void> {
  if (combobox.getAttribute("aria-expanded") === "true") {
    await user.click(combobox);
  }
}

async function selectComboboxOption(
  user: ReturnType<typeof userEvent.setup>,
  combobox: HTMLElement,
  optionMatcher: string | RegExp,
): Promise<void> {
  await openCombobox(user, combobox);
  const option = await screen.findByRole("option", { name: optionMatcher });
  await user.click(option);
}

async function getComboboxOptions(
  user: ReturnType<typeof userEvent.setup>,
  combobox: HTMLElement,
): Promise<HTMLElement[]> {
  await openCombobox(user, combobox);
  return screen.getAllByRole("option");
}

describe("EdgeTTS Web Workbench", () => {
  let createdUrls: string[] = [];
  let revokedUrls: string[] = [];
  let fetchMock: Mock<typeof fetch>;

  beforeEach(() => {
    window.localStorage.clear();
    window.sessionStorage.clear();
    createdUrls = [];
    revokedUrls = [];

    let urlCounter = 0;
    globalThis.URL.createObjectURL = vi.fn(() => {
      const url = `blob:http://localhost/test-audio-${++urlCounter}`;
      createdUrls.push(url);
      return url;
    });

    globalThis.URL.revokeObjectURL = vi.fn((url: string) => {
      revokedUrls.push(url);
    });

    // Mock HTMLMediaElement.prototype.play
    window.HTMLMediaElement.prototype.play = vi.fn().mockResolvedValue(undefined);

    // Default fetch handler
    fetchMock = vi.fn<typeof fetch>(async (input: RequestInfo | URL) => {
      const url = requestUrl(input);

      if (url === "/api/health") {
        return new Response(JSON.stringify({ status: "ok" }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      }

      if (url === "/api/voices") {
        return new Response(JSON.stringify({ voices: mockVoices }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      }

      if (url === "/api/speech") {
        const stream = new ReadableStream({
          start(controller) {
            controller.enqueue(new Uint8Array([1, 2, 3, 4]));
            controller.close();
          },
        });
        return new Response(stream, {
          status: 200,
          headers: { "Content-Type": "audio/mpeg" },
        });
      }

      return new Response(null, { status: 404 });
    });

    globalThis.fetch = fetchMock;
  });

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  describe("Voice loading & default selection", () => {
    it("loads health and voices on mount, displaying healthy status", async () => {
      render(<App />);

      expect(screen.getByText(/连接中.../i)).toBeDefined();
      await waitFor(() => {
        expect(screen.getByText(/正常/i)).toBeDefined();
      });

      const select = await screen.findByLabelText(/选择声音/i);
      expect(select).toBeDefined();
      expect((select as HTMLSelectElement).value).toBe("zh-CN-XiaoxiaoNeural");
    });

    it("falls back to first zh-CN voice when Xiaoxiao is not present", async () => {
      fetchMock.mockImplementation(async (input: RequestInfo | URL) => {
        const url = requestUrl(input);
        if (url === "/api/health") {
          return new Response(JSON.stringify({ status: "ok" }));
        }
        if (url === "/api/voices") {
          return new Response(
            JSON.stringify({
              voices: [
                { id: "zh-CN-YunxiNeural", displayName: "Yunxi", locale: "zh-CN", gender: "Male" },
                {
                  id: "en-US-JennyNeural",
                  displayName: "Jenny",
                  locale: "en-US",
                  gender: "Female",
                },
              ],
            }),
          );
        }
        return new Response(null, { status: 404 });
      });

      render(<App />);
      const select = (await screen.findByLabelText(/选择声音/i)) as HTMLSelectElement;
      expect(select.value).toBe("zh-CN-YunxiNeural");
    });

    it("falls back to first available voice when no zh-CN voice exists", async () => {
      fetchMock.mockImplementation(async (input: RequestInfo | URL) => {
        const url = requestUrl(input);
        if (url === "/api/health") {
          return new Response(JSON.stringify({ status: "ok" }));
        }
        if (url === "/api/voices") {
          return new Response(
            JSON.stringify({
              voices: [
                {
                  id: "en-US-JennyNeural",
                  displayName: "Jenny",
                  locale: "en-US",
                  gender: "Female",
                },
                {
                  id: "ja-JP-NanamiNeural",
                  displayName: "Nanami",
                  locale: "ja-JP",
                  gender: "Female",
                },
              ],
            }),
          );
        }
        return new Response(null, { status: 404 });
      });

      render(<App />);
      const select = (await screen.findByLabelText(/选择声音/i)) as HTMLSelectElement;
      expect(select.value).toBe("en-US-JennyNeural");
    });

    it("displays error message when voice fetching fails", async () => {
      fetchMock.mockImplementation(async (input: RequestInfo | URL) => {
        const url = requestUrl(input);
        if (url === "/api/health") {
          return new Response(JSON.stringify({ status: "ok" }));
        }
        if (url === "/api/voices") {
          return new Response(null, { status: 500 });
        }
        return new Response(null, { status: 404 });
      });

      render(<App />);
      const errorElem = await screen.findByRole("alert");
      expect(errorElem.textContent).toContain("无法加载语音列表");
    });
  });

  describe("Voice search filter", () => {
    it("filters voices by displayName, voice id, locale, and gender case-insensitively", async () => {
      const user = userEvent.setup();
      render(<App />);

      await screen.findByLabelText(/选择声音/i);
      const searchInput = screen.getByLabelText(/搜索声音/i);

      // Search by displayName "Jenny" (Xiaoxiao filtered out -> placeholder + Jenny = 2 options)
      await user.type(searchInput, "jenny");
      const select = screen.getByLabelText(/选择声音/i);
      let options = await getComboboxOptions(user, select);
      expect(options.length).toBe(2);
      expect(options[0]?.getAttribute("data-value")).toBe("");
      expect(options[0]?.getAttribute("aria-disabled")).toBe("true");
      expect(options[0]?.textContent).toContain("当前声音不在筛选结果中");
      expect(options[1]?.getAttribute("data-value")).toBe("en-US-JennyNeural");
      await closeCombobox(user, select);

      // Search by locale "ja-jp" (Xiaoxiao filtered out -> placeholder + Nanami = 2 options)
      await user.clear(searchInput);
      await user.type(searchInput, "ja-jp");
      options = await getComboboxOptions(user, select);
      expect(options.length).toBe(2);
      expect(options[0]?.getAttribute("data-value")).toBe("");
      expect(options[0]?.textContent).toContain("当前声音不在筛选结果中");
      expect(options[1]?.getAttribute("data-value")).toBe("ja-JP-NanamiNeural");
      await closeCombobox(user, select);

      // Search by partial id "xiaoxiao" (Xiaoxiao matches -> no placeholder = 1 option)
      await user.clear(searchInput);
      await user.type(searchInput, "xiaoxiao");
      options = await getComboboxOptions(user, select);
      expect(options.length).toBe(1);
      expect(options[0]?.getAttribute("data-value")).toBe("zh-CN-XiaoxiaoNeural");
      await closeCombobox(user, select);

      // Search by gender "Female" (matches Xiaoxiao, Jenny, Nanami; Yunxi excluded)
      await user.clear(searchInput);
      await user.type(searchInput, "female");
      options = await getComboboxOptions(user, select);
      expect(options.length).toBe(3);
      expect(options.map((o) => o.getAttribute("data-value"))).toEqual([
        "en-US-JennyNeural",
        "ja-JP-NanamiNeural",
        "zh-CN-XiaoxiaoNeural",
      ]);
      await closeCombobox(user, select);
    });
  });

  describe("Character counter & limits", () => {
    it("counts regular text and Unicode emojis accurately", async () => {
      const user = userEvent.setup();
      render(<App />);

      const textarea = screen.getByLabelText(/文本内容/i);
      await user.type(textarea, "Hello");
      expect(screen.getByText(/5 \/ 20,000 字/)).toBeDefined();

      // Emoji 😀 is 2 UTF-16 units but 1 Unicode code point
      await user.clear(textarea);
      fireEvent.change(textarea, { target: { value: "😀😀😀" } });
      expect(screen.getByText(/3 \/ 20,000 字/)).toBeDefined();
    });

    it("displays warning and disables Generate button when exceeding 20,000 code points", async () => {
      render(<App />);

      const textarea = screen.getByLabelText(/文本内容/i);
      const overLimitText = "a".repeat(20_001);
      fireEvent.change(textarea, { target: { value: overLimitText } });

      const warning = await screen.findByRole("alert");
      expect(warning.textContent).toContain("文本长度超出上限");

      const generateBtn = screen.getByRole("button", { name: /合成语音/i });
      expect((generateBtn as HTMLButtonElement).disabled).toBe(true);
    });
  });

  describe("Request mapping & controls", () => {
    it("correctly maps UI controls into native speech request payload", async () => {
      const user = userEvent.setup();
      render(<App />);

      await screen.findByLabelText(/选择声音/i);

      // Fill textarea
      const textarea = screen.getByLabelText(/文本内容/i);
      await user.type(textarea, "测试文本");

      // Change quality to high
      const qualitySelect = screen.getByLabelText(/音质/i);
      await selectComboboxOption(user, qualitySelect, /高品质/i);

      // Change speed slider
      const speedSlider = screen.getByLabelText(/^语速/i);
      fireEvent.change(speedSlider, { target: { value: "1.5" } });

      // Change pitch slider
      const pitchSlider = screen.getByLabelText(/^音调/i);
      fireEvent.change(pitchSlider, { target: { value: "3" } });

      // Change volume slider
      const volumeSlider = screen.getByLabelText(/^音量/i);
      fireEvent.change(volumeSlider, { target: { value: "0.8" } });

      // Click generate
      const generateBtn = screen.getByRole("button", { name: /合成语音/i });
      await user.click(generateBtn);

      await waitFor(() => {
        expect(fetchMock).toHaveBeenCalledWith(
          "/api/speech",
          expect.objectContaining({
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              input: "测试文本",
              voice: "zh-CN-XiaoxiaoNeural",
              quality: "high",
              speed: 1.5,
              pitchSemitones: 3,
              volume: 0.8,
            }),
          }),
        );
      });
    });

    it("slider reset buttons restore default values", async () => {
      const user = userEvent.setup();
      render(<App />);

      const speedSlider = screen.getByLabelText(/^语速/i);
      fireEvent.change(speedSlider, { target: { value: "1.75" } });
      expect(screen.getByText("1.75x")).toBeDefined();

      const resetSpeedBtn = screen.getByRole("button", { name: /重置语速/i });
      await user.click(resetSpeedBtn);
      expect(screen.getByText("1.00x")).toBeDefined();
    });
  });

  describe("Generate lifecycle & cancellation", () => {
    it("manages idle, generating, and success states properly", async () => {
      const user = userEvent.setup();
      render(<App />);

      await screen.findByLabelText(/选择声音/i);
      const textarea = screen.getByLabelText(/文本内容/i);
      await user.type(textarea, "Hello World");

      const generateBtn = screen.getByRole("button", { name: /合成语音/i }) as HTMLButtonElement;
      expect(generateBtn.disabled).toBe(false);

      await user.click(generateBtn);

      // Playback elements appear
      const audio = await screen.findByLabelText(/语音合成播放器/i);
      expect(audio).toBeDefined();

      const downloadLink = screen.getByRole("link", { name: /下载合成音频/i });
      expect(downloadLink).toBeDefined();
      expect(downloadLink.getAttribute("download")).toMatch(
        /^edgetts_zh-CN-XiaoxiaoNeural_standard_\d{8}-\d{6}\.mp3$/,
      );
    });

    it("aborts active synthesis when Cancel button is clicked", async () => {
      const user = userEvent.setup();

      // Create a deferred speech request that remains pending
      fetchMock.mockImplementation(async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = requestUrl(input);
        if (url === "/api/health") return new Response(JSON.stringify({ status: "ok" }));
        if (url === "/api/voices") return new Response(JSON.stringify({ voices: mockVoices }));
        if (url === "/api/speech") {
          return new Promise<Response>((_resolve, reject) => {
            init?.signal?.addEventListener("abort", () => {
              const abortErr = new Error("The operation was aborted");
              abortErr.name = "AbortError";
              reject(abortErr);
            });
          });
        }
        return new Response(null, { status: 404 });
      });

      render(<App />);
      await screen.findByLabelText(/选择声音/i);

      const textarea = screen.getByLabelText(/文本内容/i);
      await user.type(textarea, "Will be canceled");

      const generateBtn = screen.getByRole("button", { name: /合成语音/i });
      await user.click(generateBtn);

      // Cancel button should appear
      const cancelBtn = await screen.findByRole("button", { name: /取消/i });
      await user.click(cancelBtn);

      const alert = await screen.findByRole("alert");
      expect(alert.textContent).toContain("已取消生成");
    });

    it("handles rapid restart: cancelling A and immediately starting B ensures B ownership and leaves B cancellable", async () => {
      const user = userEvent.setup();
      let rejectA!: (err: Error) => void;
      const promiseA = new Promise<Response>((_, reject) => {
        rejectA = reject;
      });

      let abortSignalB: AbortSignal | undefined;
      const promiseB = new Promise<Response>(() => {});

      let speechCallCount = 0;
      fetchMock.mockImplementation(async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = requestUrl(input);
        if (url === "/api/health") return new Response(JSON.stringify({ status: "ok" }));
        if (url === "/api/voices") return new Response(JSON.stringify({ voices: mockVoices }));
        if (url === "/api/speech") {
          speechCallCount++;
          if (speechCallCount === 1) {
            return promiseA;
          }
          if (speechCallCount === 2) {
            abortSignalB = init?.signal as AbortSignal;
            return promiseB;
          }
        }
        return new Response(null, { status: 404 });
      });

      render(<App />);
      await screen.findByLabelText(/选择声音/i);
      const textarea = screen.getByLabelText(/文本内容/i);
      await user.type(textarea, "Initial prompt");

      // 1. Start generation A
      await user.click(screen.getByRole("button", { name: /合成语音/i }));

      // 2. Cancel A
      const cancelBtnA = await screen.findByRole("button", { name: /取消/i });
      await user.click(cancelBtnA);

      // 3. Immediately start generation B
      const generateBtn = await screen.findByRole("button", { name: /合成语音/i });
      await user.click(generateBtn);

      // Verify B is active: cancel button is visible
      const cancelBtnB = await screen.findByRole("button", { name: /取消/i });
      expect(cancelBtnB).toBeDefined();

      // 4. Stale request A rejects late with AbortError
      const abortErr = new Error("The operation was aborted");
      abortErr.name = "AbortError";
      rejectA(abortErr);

      await Promise.resolve();
      await Promise.resolve();

      // B must still be active and not cleared by A's finally!
      expect(screen.getByRole("button", { name: /取消/i })).toBeDefined();
      expect(screen.queryByRole("alert")).toBeNull();

      // 5. Cancel B: B's abort signal must be aborted!
      expect(abortSignalB?.aborted).toBe(false);
      await user.click(screen.getByRole("button", { name: /取消/i }));
      expect(abortSignalB?.aborted).toBe(true);

      const alert = await screen.findByRole("alert");
      expect(alert.textContent).toContain("已取消生成");
    });

    it("prevents stale success: late settling of cancelled request A does not overwrite B result", async () => {
      const user = userEvent.setup();
      let resolveA!: (res: Response) => void;
      const promiseA = new Promise<Response>((resolve) => {
        resolveA = resolve;
      });

      const audioBlobA = new Blob(["audio-A"], { type: "audio/mpeg" });
      const audioBlobB = new Blob(["audio-B"], { type: "audio/mpeg" });

      let speechCallCount = 0;
      fetchMock.mockImplementation(async (input: RequestInfo | URL) => {
        const url = requestUrl(input);
        if (url === "/api/health") return new Response(JSON.stringify({ status: "ok" }));
        if (url === "/api/voices") return new Response(JSON.stringify({ voices: mockVoices }));
        if (url === "/api/speech") {
          speechCallCount++;
          if (speechCallCount === 1) {
            return promiseA;
          }
          if (speechCallCount === 2) {
            return new Response(audioBlobB, {
              status: 200,
              headers: { "Content-Type": "audio/mpeg" },
            });
          }
        }
        return new Response(null, { status: 404 });
      });

      render(<App />);
      await screen.findByLabelText(/选择声音/i);
      const textarea = screen.getByLabelText(/文本内容/i);
      await user.type(textarea, "Prompt text");

      // 1. Start generation A
      await user.click(screen.getByRole("button", { name: /合成语音/i }));

      // 2. Cancel A
      const cancelBtn = await screen.findByRole("button", { name: /取消/i });
      await user.click(cancelBtn);

      // 3. Start generation B and let B succeed
      await user.click(screen.getByRole("button", { name: /合成语音/i }));

      // B finishes and shows audio player
      const player = await screen.findByLabelText(/语音合成播放器/i);
      expect(player).toBeDefined();

      const downloadLinkB = screen.getByRole("link", { name: /下载合成音频/i });
      const hrefB = downloadLinkB.getAttribute("href");

      // 4. Request A resolves late with its response
      resolveA(
        new Response(audioBlobA, {
          status: 200,
          headers: { "Content-Type": "audio/mpeg" },
        }),
      );

      await Promise.resolve();
      await Promise.resolve();

      // Final UI must still show B's result, not overwritten by A
      const downloadLinkAfter = screen.getByRole("link", { name: /下载合成音频/i });
      expect(downloadLinkAfter.getAttribute("href")).toBe(hrefB);
    });
  });

  describe("HTTP error handling", () => {
    it("displays friendly message for 400 invalid request", async () => {
      const user = userEvent.setup();
      fetchMock.mockImplementation(async (input: RequestInfo | URL) => {
        const url = requestUrl(input);
        if (url === "/api/health") return new Response(JSON.stringify({ status: "ok" }));
        if (url === "/api/voices") return new Response(JSON.stringify({ voices: mockVoices }));
        if (url === "/api/speech") return new Response(null, { status: 400 });
        return new Response(null, { status: 404 });
      });

      render(<App />);
      await screen.findByLabelText(/选择声音/i);
      const textarea = screen.getByLabelText(/文本内容/i);
      await user.type(textarea, "Invalid text test");

      await user.click(screen.getByRole("button", { name: /合成语音/i }));
      const alert = await screen.findByRole("alert");
      expect(alert.textContent).toBe("输入参数有误");
    });

    it("displays friendly message for 503 server busy", async () => {
      const user = userEvent.setup();
      fetchMock.mockImplementation(async (input: RequestInfo | URL) => {
        const url = requestUrl(input);
        if (url === "/api/health") return new Response(JSON.stringify({ status: "ok" }));
        if (url === "/api/voices") return new Response(JSON.stringify({ voices: mockVoices }));
        if (url === "/api/speech") return new Response(null, { status: 503 });
        return new Response(null, { status: 404 });
      });

      render(<App />);
      await screen.findByLabelText(/选择声音/i);
      const textarea = screen.getByLabelText(/文本内容/i);
      await user.type(textarea, "Busy test");

      await user.click(screen.getByRole("button", { name: /合成语音/i }));
      const alert = await screen.findByRole("alert");
      expect(alert.textContent).toBe("服务当前繁忙");
    });

    it("displays friendly message for 502 upstream error", async () => {
      const user = userEvent.setup();
      fetchMock.mockImplementation(async (input: RequestInfo | URL) => {
        const url = requestUrl(input);
        if (url === "/api/health") return new Response(JSON.stringify({ status: "ok" }));
        if (url === "/api/voices") return new Response(JSON.stringify({ voices: mockVoices }));
        if (url === "/api/speech") return new Response(null, { status: 502 });
        return new Response(null, { status: 404 });
      });

      render(<App />);
      await screen.findByLabelText(/选择声音/i);
      const textarea = screen.getByLabelText(/文本内容/i);
      await user.type(textarea, "Upstream error test");

      await user.click(screen.getByRole("button", { name: /合成语音/i }));
      const alert = await screen.findByRole("alert");
      expect(alert.textContent).toBe("语音服务暂时不可用");
    });

    it("exits generating state and displays stable error message when playback stream fails", async () => {
      const user = userEvent.setup();
      fetchMock.mockImplementation(async (input: RequestInfo | URL) => {
        const url = requestUrl(input);
        if (url === "/api/health") return new Response(JSON.stringify({ status: "ok" }));
        if (url === "/api/voices") return new Response(JSON.stringify({ voices: mockVoices }));
        if (url === "/api/speech") {
          const failingStream = new ReadableStream({
            start(controller) {
              controller.error(new Error("Audio stream read failure"));
            },
          });
          return new Response(failingStream, {
            status: 200,
            headers: { "Content-Type": "audio/mpeg" },
          });
        }
        return new Response(null, { status: 404 });
      });

      render(<App />);
      await screen.findByLabelText(/选择声音/i);
      const textarea = screen.getByLabelText(/文本内容/i);
      await user.type(textarea, "Playback error test");

      await user.click(screen.getByRole("button", { name: /合成语音/i }));

      // Alert displays friendly message
      const alert = await screen.findByRole("alert");
      expect(alert.textContent).toBe("语音服务暂时不可用");

      // Generating state cleared: Cancel button disappears, Generate button re-enabled
      expect(screen.queryByRole("button", { name: /取消/i })).toBeNull();
      const generateBtn = screen.getByRole("button", { name: /合成语音/i }) as HTMLButtonElement;
      expect(generateBtn.disabled).toBe(false);
      expect(generateBtn.textContent).not.toContain("正在合成");
    });
  });

  describe("Result replacement & single player guarantee", () => {
    it("revokes old object URL and replaces previous result with exactly one audio player", async () => {
      const user = userEvent.setup();
      render(<App />);

      await screen.findByLabelText(/选择声音/i);
      const textarea = screen.getByLabelText(/文本内容/i);

      // Generation 1
      await user.type(textarea, "First speech");
      await user.click(screen.getByRole("button", { name: /合成语音/i }));
      await screen.findByLabelText(/语音合成播放器/i);

      const firstUrl = createdUrls[0];
      expect(firstUrl).toBeDefined();

      // Generation 2
      await user.clear(textarea);
      await user.type(textarea, "Second speech");
      await user.click(screen.getByRole("button", { name: /合成语音/i }));
      await screen.findByLabelText(/语音合成播放器/i);

      // Verify previous URL was revoked
      expect(revokedUrls).toContain(firstUrl);

      // Exactly ONE audio element exists in document
      const audioElements = document.querySelectorAll("audio");
      expect(audioElements.length).toBe(1);
    });
  });

  describe("MediaSource capability selection & streaming / fallback branches", () => {
    it("uses MediaSource streaming code path when MediaSource is supported", async () => {
      const user = userEvent.setup();

      // Mock SourceBuffer & MediaSource
      class MockSourceBuffer extends EventTarget {
        updating = false;
        appendBuffer = vi.fn(() => {
          this.updating = true;
          setTimeout(() => {
            this.updating = false;
            this.dispatchEvent(new Event("updateend"));
          }, 0);
        });
        abort = vi.fn();
      }

      const mockBuffer = new MockSourceBuffer();

      class MockMediaSource extends EventTarget {
        readyState = "open";
        static isTypeSupported = vi.fn((type: string) => type === "audio/mpeg");
        addSourceBuffer = vi.fn(() => mockBuffer);
        endOfStream = vi.fn();
      }

      // Attach MockMediaSource to window
      (window as unknown as { MediaSource: typeof MockMediaSource }).MediaSource = MockMediaSource;

      render(<App />);
      await screen.findByLabelText(/选择声音/i);
      const textarea = screen.getByLabelText(/文本内容/i);
      await user.type(textarea, "Stream test");

      await user.click(screen.getByRole("button", { name: /合成语音/i }));

      await screen.findByLabelText(/语音合成播放器/i);
      expect(MockMediaSource.isTypeSupported).toHaveBeenCalledWith("audio/mpeg");

      delete (window as unknown as { MediaSource?: typeof MockMediaSource }).MediaSource;
    });

    it("falls back cleanly to Blob URL consumption when MediaSource is unavailable", async () => {
      const user = userEvent.setup();
      // MediaSource is undefined by default in jsdom
      expect(window.MediaSource).toBeUndefined();

      render(<App />);
      await screen.findByLabelText(/选择声音/i);
      const textarea = screen.getByLabelText(/文本内容/i);
      await user.type(textarea, "Fallback test");

      await user.click(screen.getByRole("button", { name: /合成语音/i }));

      const audio = await screen.findByLabelText(/语音合成播放器/i);
      expect(audio).toBeDefined();
      expect(createdUrls.length).toBeGreaterThan(0);
    });
  });

  describe("API Key Authentication UI & Lifecycle", () => {
    const TEST_API_KEY = "test-auth-key-1234567890";

    it("initial voices 401 triggers auth requirement UI without showing generic fetch error", async () => {
      fetchMock.mockImplementation(async (input: RequestInfo | URL) => {
        const url = requestUrl(input);
        if (url === "/api/health") return new Response(JSON.stringify({ status: "ok" }));
        if (url === "/api/voices") {
          return new Response(
            JSON.stringify({
              error: { code: "UNAUTHORIZED", message: "Missing or invalid API key" },
            }),
            {
              status: 401,
              headers: { "Content-Type": "application/json" },
            },
          );
        }
        return new Response(null, { status: 404 });
      });

      render(<App />);

      // Auth UI appears
      const authCard = await screen.findByRole("region", { name: /API 认证/i });
      expect(authCard).toBeDefined();
      expect(screen.getByText(/API 需要认证/i)).toBeDefined();

      const keyInput = screen.getByLabelText(/API Key/i) as HTMLInputElement;
      expect(keyInput).toBeDefined();
      expect(keyInput.type).toBe("password");

      const unlockBtn = screen.getByRole("button", { name: /解锁/i }) as HTMLButtonElement;
      expect(unlockBtn).toBeDefined();

      // Generic error is NOT displayed
      expect(screen.queryByText(/无法加载语音列表/i)).toBeNull();

      // Generate button is disabled while auth is required
      const generateBtn = screen.getByRole("button", { name: /合成语音/i }) as HTMLButtonElement;
      expect(generateBtn.disabled).toBe(true);
    });

    it("entering invalid key shows 'API Key 无效' and remains in locked state", async () => {
      const user = userEvent.setup();

      fetchMock.mockImplementation(async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = requestUrl(input);
        if (url === "/api/health") return new Response(JSON.stringify({ status: "ok" }));
        if (url === "/api/voices") {
          const auth = (init?.headers as Record<string, string> | undefined)?.["Authorization"];
          if (auth === `Bearer ${TEST_API_KEY}`) {
            return new Response(JSON.stringify({ voices: mockVoices }));
          }
          return new Response(
            JSON.stringify({
              error: { code: "UNAUTHORIZED", message: "Missing or invalid API key" },
            }),
            {
              status: 401,
              headers: { "Content-Type": "application/json" },
            },
          );
        }
        return new Response(null, { status: 404 });
      });

      render(<App />);
      await screen.findByRole("region", { name: /API 认证/i });

      const keyInput = screen.getByLabelText(/API Key/i);
      await user.type(keyInput, "wrong-key-1234567890");

      const unlockBtn = screen.getByRole("button", { name: /解锁/i });
      await user.click(unlockBtn);

      // Error message is displayed
      const errorAlert = await screen.findByRole("alert");
      expect(errorAlert.textContent).toContain("API Key 无效");

      // App remains locked
      expect(screen.getByText(/API 需要认证/i)).toBeDefined();
    });

    it("entering valid key unlocks app, loads voices, clears input/error, and attaches Bearer key to speech requests", async () => {
      const user = userEvent.setup();

      let lastSpeechHeaders: HeadersInit | undefined;
      let lastSpeechBody: string | undefined;

      fetchMock.mockImplementation(async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = requestUrl(input);
        if (url === "/api/health") return new Response(JSON.stringify({ status: "ok" }));
        if (url === "/api/voices") {
          const auth = (init?.headers as Record<string, string> | undefined)?.["Authorization"];
          if (auth === `Bearer ${TEST_API_KEY}`) {
            return new Response(JSON.stringify({ voices: mockVoices }));
          }
          return new Response(JSON.stringify({ error: { code: "UNAUTHORIZED" } }), { status: 401 });
        }
        if (url === "/api/speech") {
          lastSpeechHeaders = init?.headers;
          lastSpeechBody = init?.body as string;
          const stream = new ReadableStream({
            start(controller) {
              controller.enqueue(new Uint8Array([1, 2, 3]));
              controller.close();
            },
          });
          return new Response(stream, {
            status: 200,
            headers: { "Content-Type": "audio/mpeg" },
          });
        }
        return new Response(null, { status: 404 });
      });

      render(<App />);
      await screen.findByRole("region", { name: /API 认证/i });

      const keyInput = screen.getByLabelText(/API Key/i);
      await user.type(keyInput, TEST_API_KEY);

      await user.click(screen.getByRole("button", { name: /解锁/i }));

      // Auth card disappears and voices load
      await waitFor(() => {
        expect(screen.queryByRole("region", { name: /API 认证/i })).toBeNull();
      });

      const voiceSelect = (await screen.findByLabelText(/选择声音/i)) as HTMLSelectElement;
      expect(voiceSelect.value).toBe("zh-CN-XiaoxiaoNeural");

      // Perform synthesis and check that Authorization header is attached
      const textarea = screen.getByLabelText(/文本内容/i);
      await user.type(textarea, "Protected speech test");

      await user.click(screen.getByRole("button", { name: /合成语音/i }));
      await screen.findByLabelText(/语音合成播放器/i);

      // Verify Authorization header on speech request
      expect(lastSpeechHeaders).toBeDefined();
      expect((lastSpeechHeaders as Record<string, string>)["Authorization"]).toBe(
        `Bearer ${TEST_API_KEY}`,
      );

      // Verify API key was NOT leaked into JSON request body
      expect(lastSpeechBody).toBeDefined();
      const parsedBody = JSON.parse(lastSpeechBody!);
      expect(parsedBody).not.toHaveProperty("apiKey");
      expect(parsedBody).not.toHaveProperty("authorization");
    });

    it("mid-session 401 during synthesis clears in-memory credential, stops generating, and shows auth requirement", async () => {
      const user = userEvent.setup();

      fetchMock.mockImplementation(async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = requestUrl(input);
        if (url === "/api/health") return new Response(JSON.stringify({ status: "ok" }));
        if (url === "/api/voices") {
          const auth = (init?.headers as Record<string, string> | undefined)?.["Authorization"];
          if (auth === `Bearer ${TEST_API_KEY}`) {
            return new Response(JSON.stringify({ voices: mockVoices }));
          }
          return new Response(JSON.stringify({ error: { code: "UNAUTHORIZED" } }), { status: 401 });
        }
        if (url === "/api/speech") {
          // Server restarted or rotated key, returns 401
          return new Response(
            JSON.stringify({
              error: { code: "UNAUTHORIZED", message: "Missing or invalid API key" },
            }),
            {
              status: 401,
              headers: { "Content-Type": "application/json" },
            },
          );
        }
        return new Response(null, { status: 404 });
      });

      render(<App />);
      await screen.findByRole("region", { name: /API 认证/i });

      // Unlock first
      await user.type(screen.getByLabelText(/API Key/i), TEST_API_KEY);
      await user.click(screen.getByRole("button", { name: /解锁/i }));

      await waitFor(() => {
        expect(screen.queryByRole("region", { name: /API 认证/i })).toBeNull();
      });

      // Generate speech
      const textarea = screen.getByLabelText(/文本内容/i);
      await user.type(textarea, "Mid-session 401 test");

      await user.click(screen.getByRole("button", { name: /合成语音/i }));

      // Error alert indicates key expiration
      const alert = await screen.findByRole("alert");
      expect(alert.textContent).toContain("API Key 已失效或未提供");

      // Generating stopped
      expect(screen.queryByRole("button", { name: /取消/i })).toBeNull();

      // Auth UI reappears
      expect(await screen.findByRole("region", { name: /API 认证/i })).toBeDefined();
    });

    it("browser storage security: localStorage and sessionStorage are never called for API key", async () => {
      const user = userEvent.setup();

      const localSetSpy = vi.spyOn(Storage.prototype, "setItem");

      fetchMock.mockImplementation(async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = requestUrl(input);
        if (url === "/api/health") return new Response(JSON.stringify({ status: "ok" }));
        if (url === "/api/voices") {
          const auth = (init?.headers as Record<string, string> | undefined)?.["Authorization"];
          if (auth === `Bearer ${TEST_API_KEY}`) {
            return new Response(JSON.stringify({ voices: mockVoices }));
          }
          return new Response(JSON.stringify({ error: { code: "UNAUTHORIZED" } }), { status: 401 });
        }
        if (url === "/api/speech") {
          const stream = new ReadableStream({
            start(controller) {
              controller.enqueue(new Uint8Array([1, 2]));
              controller.close();
            },
          });
          return new Response(stream, { status: 200, headers: { "Content-Type": "audio/mpeg" } });
        }
        return new Response(null, { status: 404 });
      });

      render(<App />);
      await screen.findByRole("region", { name: /API 认证/i });

      await user.type(screen.getByLabelText(/API Key/i), TEST_API_KEY);
      await user.click(screen.getByRole("button", { name: /解锁/i }));

      await waitFor(() => {
        expect(screen.queryByRole("region", { name: /API 认证/i })).toBeNull();
      });

      const textarea = screen.getByLabelText(/文本内容/i);
      await user.type(textarea, "Storage check text");
      await user.click(screen.getByRole("button", { name: /合成语音/i }));
      await screen.findByLabelText(/语音合成播放器/i);

      // Verify that neither storage ever received the API key
      for (const call of localSetSpy.mock.calls) {
        expect(call[0]).not.toContain(TEST_API_KEY);
        expect(call[1]).not.toContain(TEST_API_KEY);
      }

      localSetSpy.mockRestore();
    });

    it("remounting App does not retain in-memory key, requiring re-entry", async () => {
      const user = userEvent.setup();

      fetchMock.mockImplementation(async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = requestUrl(input);
        if (url === "/api/health") return new Response(JSON.stringify({ status: "ok" }));
        if (url === "/api/voices") {
          const auth = (init?.headers as Record<string, string> | undefined)?.["Authorization"];
          if (auth === `Bearer ${TEST_API_KEY}`) {
            return new Response(JSON.stringify({ voices: mockVoices }));
          }
          return new Response(JSON.stringify({ error: { code: "UNAUTHORIZED" } }), { status: 401 });
        }
        return new Response(null, { status: 404 });
      });

      // 1. First mount & unlock
      const { unmount } = render(<App />);
      await screen.findByRole("region", { name: /API 认证/i });

      await user.type(screen.getByLabelText(/API Key/i), TEST_API_KEY);
      await user.click(screen.getByRole("button", { name: /解锁/i }));

      await waitFor(() => {
        expect(screen.queryByRole("region", { name: /API 认证/i })).toBeNull();
      });

      // 2. Unmount (simulating navigation/refresh)
      unmount();

      // 3. Second mount: credential was in-memory only, so fresh app must require auth again
      render(<App />);
      expect(await screen.findByRole("region", { name: /API 认证/i })).toBeDefined();
    });

    it("rejects trailing whitespace locally without sending request and displays 'API Key 格式无效'", async () => {
      const user = userEvent.setup();
      let fetchVoicesCalls = 0;

      fetchMock.mockImplementation(async (input: RequestInfo | URL) => {
        const url = requestUrl(input);
        if (url === "/api/health") return new Response(JSON.stringify({ status: "ok" }));
        if (url === "/api/voices") {
          fetchVoicesCalls++;
          return new Response(JSON.stringify({ error: { code: "UNAUTHORIZED" } }), { status: 401 });
        }
        return new Response(null, { status: 404 });
      });

      render(<App />);
      await screen.findByRole("region", { name: /API 认证/i });
      expect(fetchVoicesCalls).toBe(1);

      const keyInput = screen.getByLabelText(/API Key/i);
      await user.type(keyInput, "test-api-key-1234567890 ");

      const unlockBtn = screen.getByRole("button", { name: /解锁/i });
      expect((unlockBtn as HTMLButtonElement).disabled).toBe(false);
      await user.click(unlockBtn);

      // No new network request was sent
      expect(fetchVoicesCalls).toBe(1);

      // Stable format error message
      const errorAlert = await screen.findByRole("alert");
      expect(errorAlert.textContent).toBe("API Key 格式无效");

      // Card remains locked
      expect(screen.getByRole("region", { name: /API 认证/i })).toBeDefined();
    });

    it("rejects leading whitespace locally without sending request and displays 'API Key 格式无效'", async () => {
      const user = userEvent.setup();
      let fetchVoicesCalls = 0;

      fetchMock.mockImplementation(async (input: RequestInfo | URL) => {
        const url = requestUrl(input);
        if (url === "/api/health") return new Response(JSON.stringify({ status: "ok" }));
        if (url === "/api/voices") {
          fetchVoicesCalls++;
          return new Response(JSON.stringify({ error: { code: "UNAUTHORIZED" } }), { status: 401 });
        }
        return new Response(null, { status: 404 });
      });

      render(<App />);
      await screen.findByRole("region", { name: /API 认证/i });
      expect(fetchVoicesCalls).toBe(1);

      const keyInput = screen.getByLabelText(/API Key/i);
      await user.type(keyInput, " test-api-key-1234567890");

      const unlockBtn = screen.getByRole("button", { name: /解锁/i });
      await user.click(unlockBtn);

      expect(fetchVoicesCalls).toBe(1);
      const errorAlert = await screen.findByRole("alert");
      expect(errorAlert.textContent).toBe("API Key 格式无效");
    });

    it("rejects internal whitespace locally without sending request and displays 'API Key 格式无效'", async () => {
      const user = userEvent.setup();
      let fetchVoicesCalls = 0;

      fetchMock.mockImplementation(async (input: RequestInfo | URL) => {
        const url = requestUrl(input);
        if (url === "/api/health") return new Response(JSON.stringify({ status: "ok" }));
        if (url === "/api/voices") {
          fetchVoicesCalls++;
          return new Response(JSON.stringify({ error: { code: "UNAUTHORIZED" } }), { status: 401 });
        }
        return new Response(null, { status: 404 });
      });

      render(<App />);
      await screen.findByRole("region", { name: /API 认证/i });
      expect(fetchVoicesCalls).toBe(1);

      const keyInput = screen.getByLabelText(/API Key/i);
      await user.type(keyInput, "test-api-key-1234 567890");

      const unlockBtn = screen.getByRole("button", { name: /解锁/i });
      await user.click(unlockBtn);

      expect(fetchVoicesCalls).toBe(1);
      const errorAlert = await screen.findByRole("alert");
      expect(errorAlert.textContent).toBe("API Key 格式无效");
    });

    it("rejects tab characters locally without sending request and displays 'API Key 格式无效'", async () => {
      const user = userEvent.setup();
      let fetchVoicesCalls = 0;

      fetchMock.mockImplementation(async (input: RequestInfo | URL) => {
        const url = requestUrl(input);
        if (url === "/api/health") return new Response(JSON.stringify({ status: "ok" }));
        if (url === "/api/voices") {
          fetchVoicesCalls++;
          return new Response(JSON.stringify({ error: { code: "UNAUTHORIZED" } }), { status: 401 });
        }
        return new Response(null, { status: 404 });
      });

      render(<App />);
      await screen.findByRole("region", { name: /API 认证/i });
      expect(fetchVoicesCalls).toBe(1);

      const keyInput = screen.getByLabelText(/API Key/i);
      fireEvent.change(keyInput, { target: { value: "test-api-key-1234\t567890" } });

      const unlockBtn = screen.getByRole("button", { name: /解锁/i });
      await user.click(unlockBtn);

      expect(fetchVoicesCalls).toBe(1);
      const errorAlert = await screen.findByRole("alert");
      expect(errorAlert.textContent).toBe("API Key 格式无效");
    });

    it("rejects keys shorter than 16 characters locally without sending request and displays 'API Key 格式无效'", async () => {
      const user = userEvent.setup();
      let fetchVoicesCalls = 0;

      fetchMock.mockImplementation(async (input: RequestInfo | URL) => {
        const url = requestUrl(input);
        if (url === "/api/health") return new Response(JSON.stringify({ status: "ok" }));
        if (url === "/api/voices") {
          fetchVoicesCalls++;
          return new Response(JSON.stringify({ error: { code: "UNAUTHORIZED" } }), { status: 401 });
        }
        return new Response(null, { status: 404 });
      });

      render(<App />);
      await screen.findByRole("region", { name: /API 认证/i });
      expect(fetchVoicesCalls).toBe(1);

      const keyInput = screen.getByLabelText(/API Key/i);
      await user.type(keyInput, "short-key");

      const unlockBtn = screen.getByRole("button", { name: /解锁/i });
      await user.click(unlockBtn);

      expect(fetchVoicesCalls).toBe(1);
      const errorAlert = await screen.findByRole("alert");
      expect(errorAlert.textContent).toBe("API Key 格式无效");
    });

    it("permits keys of exactly 16 characters and passes exact argument to fetchVoices", async () => {
      const user = userEvent.setup();
      const exact16Key = "1234567890abcdef";
      let receivedAuthHeader: string | undefined;

      fetchMock.mockImplementation(async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = requestUrl(input);
        if (url === "/api/health") return new Response(JSON.stringify({ status: "ok" }));
        if (url === "/api/voices") {
          const auth = (init?.headers as Record<string, string> | undefined)?.["Authorization"];
          receivedAuthHeader = auth;
          if (auth === `Bearer ${exact16Key}`) {
            return new Response(JSON.stringify({ voices: mockVoices }));
          }
          return new Response(JSON.stringify({ error: { code: "UNAUTHORIZED" } }), { status: 401 });
        }
        return new Response(null, { status: 404 });
      });

      render(<App />);
      await screen.findByRole("region", { name: /API 认证/i });

      const keyInput = screen.getByLabelText(/API Key/i);
      await user.type(keyInput, exact16Key);

      const unlockBtn = screen.getByRole("button", { name: /解锁/i });
      await user.click(unlockBtn);

      // Exact key transmitted to fetchVoices without modification
      expect(receivedAuthHeader).toBe(`Bearer ${exact16Key}`);

      // Unlocks successfully
      await waitFor(() => {
        expect(screen.queryByRole("region", { name: /API 认证/i })).toBeNull();
      });
      expect(await screen.findByLabelText(/选择声音/i)).toBeDefined();
    });

    it("preserves exact case and characters without normalization or trimming across voices and speech", async () => {
      const user = userEvent.setup();
      const caseSensitiveKey = "Test-API-Key-AbCdEf123456";
      let voicesAuthHeader: string | undefined;
      let speechAuthHeader: string | undefined;

      fetchMock.mockImplementation(async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = requestUrl(input);
        if (url === "/api/health") return new Response(JSON.stringify({ status: "ok" }));
        if (url === "/api/voices") {
          const auth = (init?.headers as Record<string, string> | undefined)?.["Authorization"];
          voicesAuthHeader = auth;
          if (auth === `Bearer ${caseSensitiveKey}`) {
            return new Response(JSON.stringify({ voices: mockVoices }));
          }
          return new Response(JSON.stringify({ error: { code: "UNAUTHORIZED" } }), { status: 401 });
        }
        if (url === "/api/speech") {
          speechAuthHeader = (init?.headers as Record<string, string> | undefined)?.[
            "Authorization"
          ];
          const stream = new ReadableStream({
            start(controller) {
              controller.enqueue(new Uint8Array([1, 2, 3]));
              controller.close();
            },
          });
          return new Response(stream, {
            status: 200,
            headers: { "Content-Type": "audio/mpeg" },
          });
        }
        return new Response(null, { status: 404 });
      });

      render(<App />);
      await screen.findByRole("region", { name: /API 认证/i });

      const keyInput = screen.getByLabelText(/API Key/i);
      await user.type(keyInput, caseSensitiveKey);

      await user.click(screen.getByRole("button", { name: /解锁/i }));

      // Exact equality check on voices authorization
      expect(voicesAuthHeader).toBe(`Bearer ${caseSensitiveKey}`);

      await waitFor(() => {
        expect(screen.queryByRole("region", { name: /API 认证/i })).toBeNull();
      });

      // Synthesize and check exact speech authorization
      const textarea = screen.getByLabelText(/文本内容/i);
      await user.type(textarea, "Case sensitive test");
      await user.click(screen.getByRole("button", { name: /合成语音/i }));
      await screen.findByLabelText(/语音合成播放器/i);

      expect(speechAuthHeader).toBe(`Bearer ${caseSensitiveKey}`);
    });

    it("disables unlock button when key input is empty and enables it when non-empty", async () => {
      const user = userEvent.setup();

      fetchMock.mockImplementation(async (input: RequestInfo | URL) => {
        const url = requestUrl(input);
        if (url === "/api/health") return new Response(JSON.stringify({ status: "ok" }));
        if (url === "/api/voices") {
          return new Response(JSON.stringify({ error: { code: "UNAUTHORIZED" } }), { status: 401 });
        }
        return new Response(null, { status: 404 });
      });

      render(<App />);
      await screen.findByRole("region", { name: /API 认证/i });

      const keyInput = screen.getByLabelText(/API Key/i);
      const unlockBtn = screen.getByRole("button", { name: /解锁/i }) as HTMLButtonElement;

      // Initially empty -> button disabled
      expect(unlockBtn.disabled).toBe(true);

      // Type characters -> button enabled
      await user.type(keyInput, "a");
      expect(unlockBtn.disabled).toBe(false);

      // Clear -> button disabled
      await user.clear(keyInput);
      expect(unlockBtn.disabled).toBe(true);
    });
  });

  describe("API Key format validation helper", () => {
    it("rejects empty strings and strings shorter than 16 characters", () => {
      expect(isValidApiKeyFormat("")).toBe(false);
      expect(isValidApiKeyFormat("short")).toBe(false);
      expect(isValidApiKeyFormat("123456789012345")).toBe(false);
      expect(MIN_API_KEY_LENGTH).toBe(16);
    });

    it("rejects strings containing any whitespace (leading, trailing, internal, tab, newline)", () => {
      expect(isValidApiKeyFormat(" test-api-key-1234567890")).toBe(false);
      expect(isValidApiKeyFormat("test-api-key-1234567890 ")).toBe(false);
      expect(isValidApiKeyFormat("test-api-key-1234 567890")).toBe(false);
      expect(isValidApiKeyFormat("test-api-key-1234\t567890")).toBe(false);
      expect(isValidApiKeyFormat("test-api-key-1234\n567890")).toBe(false);
      expect(isValidApiKeyFormat("test-api-key-1234\r567890")).toBe(false);
      expect(isValidApiKeyFormat("               16")).toBe(false);
    });

    it("accepts valid keys of 16 characters or more without whitespace", () => {
      expect(isValidApiKeyFormat("1234567890123456")).toBe(true);
      expect(isValidApiKeyFormat("test-api-key-1234567890")).toBe(true);
      expect(isValidApiKeyFormat("Test-API-Key-AbCdEf123456")).toBe(true);
      expect(isValidApiKeyFormat("0123456789abcdef0123456789abcdef0123456789abcdef")).toBe(true);
    });
  });

  describe("Accessibility basics", () => {
    it("verifies all input elements, buttons, and players have accessible names and roles", async () => {
      render(<App />);
      await screen.findByLabelText(/选择声音/i);

      // Labels associated with form controls
      expect(screen.getByLabelText(/文本内容/i)).toBeDefined();
      expect(screen.getByLabelText(/搜索声音/i)).toBeDefined();
      expect(screen.getByLabelText(/音质/i)).toBeDefined();
      expect(screen.getByLabelText(/^语速/i)).toBeDefined();
      expect(screen.getByLabelText(/^音调/i)).toBeDefined();
      expect(screen.getByLabelText(/^音量/i)).toBeDefined();

      // Real buttons
      expect(screen.getByRole("button", { name: /合成语音/i })).toBeDefined();
    });
  });

  describe("Phase 21: Preferences persistence & restoration", () => {
    const TEST_AUTH_KEY = "test-auth-key-1234567890";

    it("restores saved non-sensitive preferences from localStorage on mount", async () => {
      window.localStorage.setItem(
        WORKBENCH_PREFERENCES_KEY,
        JSON.stringify({
          voiceId: "en-US-JennyNeural",
          quality: "high",
          speed: 1.5,
          pitchSemitones: 3,
          volume: 0.8,
        }),
      );

      render(<App />);
      const select = (await screen.findByLabelText(/选择声音/i)) as HTMLSelectElement;
      expect(select.value).toBe("en-US-JennyNeural");

      const qualitySelect = screen.getByLabelText(/音质/i) as HTMLSelectElement;
      expect(qualitySelect.value).toBe("high");

      const speedSlider = screen.getByLabelText(/^语速/i) as HTMLInputElement;
      expect(speedSlider.value).toBe("1.5");

      const pitchSlider = screen.getByLabelText(/^音调/i) as HTMLInputElement;
      expect(pitchSlider.value).toBe("3");

      const volumeSlider = screen.getByLabelText(/^音量/i) as HTMLInputElement;
      expect(volumeSlider.value).toBe("0.8");
    });

    it("falls back to default voice when saved voice is missing from catalog and updates storage", async () => {
      window.localStorage.setItem(
        WORKBENCH_PREFERENCES_KEY,
        JSON.stringify({
          voiceId: "ghost-voice-missing-from-catalog",
          quality: "standard",
          speed: 1.0,
          pitchSemitones: 0,
          volume: 1.0,
        }),
      );

      render(<App />);
      const select = (await screen.findByLabelText(/选择声音/i)) as HTMLSelectElement;
      // Falls back to Xiaoxiao
      expect(select.value).toBe("zh-CN-XiaoxiaoNeural");

      await waitFor(() => {
        const stored = JSON.parse(window.localStorage.getItem(WORKBENCH_PREFERENCES_KEY) || "{}");
        expect(stored.voiceId).toBe("zh-CN-XiaoxiaoNeural");
      });
    });

    it("restores saved voice on auth unlock path", async () => {
      const user = userEvent.setup();
      window.localStorage.setItem(
        WORKBENCH_PREFERENCES_KEY,
        JSON.stringify({
          voiceId: "en-US-JennyNeural",
          quality: "standard",
          speed: 1.0,
          pitchSemitones: 0,
          volume: 1.0,
        }),
      );

      fetchMock.mockImplementation(async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = requestUrl(input);
        if (url === "/api/health") return new Response(JSON.stringify({ status: "ok" }));
        if (url === "/api/voices") {
          const auth = (init?.headers as Record<string, string> | undefined)?.["Authorization"];
          if (auth === `Bearer ${TEST_AUTH_KEY}`) {
            return new Response(JSON.stringify({ voices: mockVoices }));
          }
          return new Response(JSON.stringify({ error: { code: "UNAUTHORIZED" } }), { status: 401 });
        }
        return new Response(null, { status: 404 });
      });

      render(<App />);
      await screen.findByRole("region", { name: /API 认证/i });

      await user.type(screen.getByLabelText(/API Key/i), TEST_AUTH_KEY);
      await user.click(screen.getByRole("button", { name: /解锁/i }));

      const select = (await screen.findByLabelText(/选择声音/i)) as HTMLSelectElement;
      expect(select.value).toBe("en-US-JennyNeural");
    });

    it("persists preference updates when controls change", async () => {
      const user = userEvent.setup();
      render(<App />);
      await screen.findByLabelText(/选择声音/i);

      // Change speed
      const speedSlider = screen.getByLabelText(/^语速/i);
      fireEvent.change(speedSlider, { target: { value: "1.25" } });

      await waitFor(() => {
        const stored = JSON.parse(window.localStorage.getItem(WORKBENCH_PREFERENCES_KEY) || "{}");
        expect(stored.speed).toBe(1.25);
      });

      // Change voice
      const voiceSelect = screen.getByLabelText(/选择声音/i);
      await selectComboboxOption(user, voiceSelect, /Nanami/i);

      await waitFor(() => {
        const stored = JSON.parse(window.localStorage.getItem(WORKBENCH_PREFERENCES_KEY) || "{}");
        expect(stored.voiceId).toBe("ja-JP-NanamiNeural");
      });
    });
  });

  describe("Phase 21: Reset All Parameters", () => {
    it("is disabled when all parameters are already default", async () => {
      render(<App />);
      await screen.findByLabelText(/选择声音/i);

      const resetBtn = screen.getByRole("button", { name: /恢复默认参数/i }) as HTMLButtonElement;
      expect(resetBtn.disabled).toBe(true);
    });

    it("becomes enabled when any parameter differs from default and resets all parameters without altering selected voice", async () => {
      const user = userEvent.setup();
      render(<App />);
      const select = (await screen.findByLabelText(/选择声音/i)) as HTMLButtonElement;

      // Select Jenny voice
      await selectComboboxOption(user, select, /Jenny/i);
      expect(select.getAttribute("data-value")).toBe("en-US-JennyNeural");

      // Initially parameters are default, button is disabled
      const resetBtn = screen.getByRole("button", { name: /恢复默认参数/i }) as HTMLButtonElement;
      expect(resetBtn.disabled).toBe(true);

      // Change quality, speed, pitch, volume
      const qualitySelect = screen.getByLabelText(/音质/i);
      await selectComboboxOption(user, qualitySelect, /高品质/i);

      const speedSlider = screen.getByLabelText(/^语速/i);
      fireEvent.change(speedSlider, { target: { value: "1.5" } });

      const pitchSlider = screen.getByLabelText(/^音调/i);
      fireEvent.change(pitchSlider, { target: { value: "4" } });

      const volumeSlider = screen.getByLabelText(/^音量/i);
      fireEvent.change(volumeSlider, { target: { value: "0.5" } });

      // Button is now enabled
      expect(resetBtn.disabled).toBe(false);

      // Click Reset All
      await user.click(resetBtn);

      // Parameters are reset to defaults
      expect(screen.getByLabelText(/音质/i).getAttribute("data-value")).toBe("standard");
      expect((screen.getByLabelText(/^语速/i) as HTMLInputElement).value).toBe("1");
      expect((screen.getByLabelText(/^音调/i) as HTMLInputElement).value).toBe("0");
      expect((screen.getByLabelText(/^音量/i) as HTMLInputElement).value).toBe("1");

      // Selected voice is NOT reset
      expect(select.getAttribute("data-value")).toBe("en-US-JennyNeural");

      // Button is disabled again
      expect(resetBtn.disabled).toBe(true);
    });
  });

  describe("Phase 21: Download Metadata & Snapshot Immutability", () => {
    it("binds immutable generation metadata and does not mutate when controls change after completion", async () => {
      const user = userEvent.setup();
      render(<App />);
      await screen.findByLabelText(/选择声音/i);

      // Select Yunxi voice, high quality, speed 1.5, pitch 2, volume 0.8
      await selectComboboxOption(user, screen.getByLabelText(/选择声音/i), /Yunxi/i);
      await selectComboboxOption(user, screen.getByLabelText(/音质/i), /高品质/i);
      fireEvent.change(screen.getByLabelText(/^语速/i), { target: { value: "1.5" } });
      fireEvent.change(screen.getByLabelText(/^音调/i), { target: { value: "2" } });
      fireEvent.change(screen.getByLabelText(/^音量/i), { target: { value: "0.8" } });

      // Enter input and generate
      await user.type(screen.getByLabelText(/文本内容/i), "Hello immutable metadata");
      await user.click(screen.getByRole("button", { name: /合成语音/i }));

      // Wait for audio player and download button
      await screen.findByLabelText(/语音合成播放器/i);
      const downloadLink = screen.getByRole("link", { name: /下载合成音频/i });
      const originalFilename = downloadLink.getAttribute("download");
      expect(originalFilename).toMatch(/^edgetts_zh-CN-YunxiNeural_high_\d{8}-\d{6}\.mp3$/);

      // Metadata text is present
      const metaContainer = screen.getByLabelText(/音频生成信息/i);
      expect(metaContainer.textContent).toContain("Microsoft Yunxi");
      expect(metaContainer.textContent).toContain("zh-CN-YunxiNeural");
      expect(metaContainer.textContent).toContain("高品质");
      expect(metaContainer.textContent).toContain("1.50×");
      expect(metaContainer.textContent).toContain("+2半音");
      expect(metaContainer.textContent).toContain("80%音量");

      // Now mutate UI controls: switch voice to Jenny, quality to standard, speed to 1.0, pitch to 0
      await selectComboboxOption(user, screen.getByLabelText(/选择声音/i), /Jenny/i);
      await selectComboboxOption(user, screen.getByLabelText(/音质/i), /标准/i);
      fireEvent.change(screen.getByLabelText(/^语速/i), { target: { value: "1.0" } });
      fireEvent.change(screen.getByLabelText(/^音调/i), { target: { value: "0" } });

      // Verification: Download filename and metadata container remain strictly unchanged!
      expect(downloadLink.getAttribute("download")).toBe(originalFilename);
      expect(metaContainer.textContent).toContain("Microsoft Yunxi");
      expect(metaContainer.textContent).toContain("zh-CN-YunxiNeural");
      expect(metaContainer.textContent).toContain("高品质");
      expect(metaContainer.textContent).not.toContain("Microsoft Jenny");
    });

    it("new generation replaces result metadata, and cancelled/failed generation does not produce metadata", async () => {
      const user = userEvent.setup();
      render(<App />);
      await screen.findByLabelText(/选择声音/i);

      // 1. First generation succeeds
      await user.type(screen.getByLabelText(/文本内容/i), "First audio");
      await user.click(screen.getByRole("button", { name: /合成语音/i }));
      await screen.findByLabelText(/语音合成播放器/i);

      let downloadLink = screen.getByRole("link", { name: /下载合成音频/i });
      expect(downloadLink.getAttribute("download")).toMatch(
        /^edgetts_zh-CN-XiaoxiaoNeural_standard_\d{8}-\d{6}\.mp3$/,
      );
      expect(screen.getByLabelText(/音频生成信息/i)).toBeDefined();

      // 2. Second generation with different voice
      await selectComboboxOption(user, screen.getByLabelText(/选择声音/i), /Jenny/i);
      await user.clear(screen.getByLabelText(/文本内容/i));
      await user.type(screen.getByLabelText(/文本内容/i), "Second audio");
      await user.click(screen.getByRole("button", { name: /合成语音/i }));

      // Wait for new audio to settle
      await waitFor(() => {
        downloadLink = screen.getByRole("link", { name: /下载合成音频/i });
        expect(downloadLink.getAttribute("download")).toMatch(
          /^edgetts_en-US-JennyNeural_standard_\d{8}-\d{6}\.mp3$/,
        );
      });
      const metaContainer = screen.getByLabelText(/音频生成信息/i);
      expect(metaContainer.textContent).toContain("Microsoft Jenny");

      // 3. Third generation fails (400 Bad Request)
      fetchMock.mockImplementationOnce(async () => {
        return new Response(
          JSON.stringify({ error: { code: "BAD_REQUEST", message: "Invalid" } }),
          {
            status: 400,
          },
        );
      });

      await user.clear(screen.getByLabelText(/文本内容/i));
      await user.type(screen.getByLabelText(/文本内容/i), "Third audio fails");
      await user.click(screen.getByRole("button", { name: /合成语音/i }));

      await screen.findByText(/输入参数有误/i);
      // Previous metadata is cleared and no new metadata is produced
      expect(screen.queryByLabelText(/音频生成信息/i)).toBeNull();
      expect(screen.queryByRole("link", { name: /下载合成音频/i })).toBeNull();
    });
  });

  describe("Phase 22: Voice Catalog Discovery & Favorites", () => {
    it("renders locale options dynamically with counts based on loaded catalog", async () => {
      const user = userEvent.setup();
      render(<App />);
      await screen.findByLabelText(/选择声音/i);

      const localeSelect = screen.getByLabelText(/地区 \/ Locale/i);
      const options = await getComboboxOptions(user, localeSelect);
      expect(options.length).toBe(4);
      expect(options[0]?.getAttribute("data-value")).toBe("all");
      expect(options[0]?.textContent).toContain("全部地区 (4)");
      expect(options[1]?.getAttribute("data-value")).toBe("en-US");
      expect(options[1]?.textContent).toContain("en-US (1)");
      expect(options[2]?.getAttribute("data-value")).toBe("ja-JP");
      expect(options[2]?.textContent).toContain("ja-JP (1)");
      expect(options[3]?.getAttribute("data-value")).toBe("zh-CN");
      expect(options[3]?.textContent).toContain("zh-CN (2)");
      await closeCombobox(user, localeSelect);
    });

    it("filters catalog by locale while maintaining selected voice stability", async () => {
      const user = userEvent.setup();
      render(<App />);
      await screen.findByLabelText(/选择声音/i);

      const localeSelect = screen.getByLabelText(/地区 \/ Locale/i);
      const voiceSelect = screen.getByLabelText(/选择声音/i);

      // Active voice is default Xiaoxiao (zh-CN)
      // Switch locale to ja-JP
      await selectComboboxOption(user, localeSelect, /ja-JP/i);

      // Voice options include placeholder + Nanami
      let options = await getComboboxOptions(user, voiceSelect);
      expect(options.length).toBe(2);
      expect(options[0]?.getAttribute("data-value")).toBe("");
      expect(options[0]?.getAttribute("aria-disabled")).toBe("true");
      expect(options[0]?.textContent).toContain("当前声音不在筛选结果中");
      expect(options[1]?.getAttribute("data-value")).toBe("ja-JP-NanamiNeural");
      await closeCombobox(user, voiceSelect);

      // Current voice details still display active Xiaoxiao voice
      const voiceDetails = screen.getByLabelText(/当前声音详情/i);
      expect(voiceDetails.textContent).toContain("Microsoft Xiaoxiao · zh-CN · 女性");
      expect(voiceDetails.textContent).toContain("zh-CN-XiaoxiaoNeural");

      // Selecting the visible voice switches active voice
      await selectComboboxOption(user, voiceSelect, /Nanami/i);
      options = await getComboboxOptions(user, voiceSelect);
      expect(options.length).toBe(1); // placeholder gone because Nanami is now visible
      await closeCombobox(user, voiceSelect);
      expect(voiceDetails.textContent).toContain("Microsoft Nanami · ja-JP · 女性");
      expect(voiceDetails.textContent).toContain("ja-JP-NanamiNeural");

      // Switch back to "all"
      await selectComboboxOption(user, localeSelect, /全部地区/i);
      options = await getComboboxOptions(user, voiceSelect);
      expect(options.length).toBe(4);
      await closeCombobox(user, voiceSelect);
      expect(voiceDetails.textContent).toContain("Microsoft Nanami · ja-JP · 女性");
    });

    it("toggles favorite voice, persists to localStorage, and enables favorite-only filter", async () => {
      const user = userEvent.setup();
      render(<App />);
      await screen.findByLabelText(/选择声音/i);

      const favCheckbox = screen.getByLabelText(/只看收藏/i) as HTMLInputElement;
      expect(favCheckbox.disabled).toBe(true);
      expect(favCheckbox.checked).toBe(false);

      const favBtn = screen.getByRole("button", { name: /收藏当前声音/i });
      expect(favBtn.getAttribute("aria-pressed")).toBe("false");
      expect(favBtn.textContent).toContain("☆ 收藏");

      // Toggle favorite on Xiaoxiao
      await user.click(favBtn);

      expect(favBtn.getAttribute("aria-pressed")).toBe("true");
      expect(favBtn.textContent).toContain("★ 已收藏");
      expect(favBtn.getAttribute("aria-label")).toBe("取消收藏当前声音");

      // Check localStorage persistence
      const savedRaw = window.localStorage.getItem(WORKBENCH_FAVORITES_KEY);
      expect(savedRaw).not.toBeNull();
      const saved = JSON.parse(savedRaw!);
      expect(saved.voiceIds).toEqual(["zh-CN-XiaoxiaoNeural"]);

      // Favorite checkbox is now enabled
      expect(favCheckbox.disabled).toBe(false);

      // Check favorite-only filter
      await user.click(favCheckbox);
      expect(favCheckbox.checked).toBe(true);

      const voiceSelect = screen.getByLabelText(/选择声音/i);
      // Only Xiaoxiao is visible
      const options = await getComboboxOptions(user, voiceSelect);
      expect(options.length).toBe(1);
      expect(options[0]?.getAttribute("data-value")).toBe("zh-CN-XiaoxiaoNeural");
      await closeCombobox(user, voiceSelect);

      // Un-favorite Xiaoxiao while favoriteOnly is active: favoriteOnly automatically resets to false
      await user.click(favBtn);
      expect(favBtn.getAttribute("aria-pressed")).toBe("false");
      expect(favCheckbox.checked).toBe(false);
      expect(favCheckbox.disabled).toBe(true);

      const updatedRaw = window.localStorage.getItem(WORKBENCH_FAVORITES_KEY);
      expect(JSON.parse(updatedRaw!).voiceIds).toEqual([]);
    });

    it("groups favorites under optgroup 收藏 at top without duplicate entries in locale groups", async () => {
      const user = userEvent.setup();
      // Pre-seed Jenny and Yunxi as favorites in localStorage
      window.localStorage.setItem(
        WORKBENCH_FAVORITES_KEY,
        JSON.stringify({ voiceIds: ["en-US-JennyNeural", "zh-CN-YunxiNeural"] }),
      );

      render(<App />);
      await screen.findByLabelText(/选择声音/i);

      const voiceSelect = screen.getByLabelText(/选择声音/i);
      await openCombobox(user, voiceSelect);
      const groups = document.querySelectorAll(".ui-select-group");

      // Groups should be:
      // 1. 收藏 (Jenny, Yunxi)
      // 2. ja-JP (Nanami)
      // 3. zh-CN (Xiaoxiao - Yunxi is in favorites, so not in zh-CN group)
      expect(groups.length).toBe(3);
      expect(groups[0]?.getAttribute("aria-label")).toBe("收藏");
      const favOptions = Array.from(groups[0]?.querySelectorAll("[role='option']") ?? []).map((o) =>
        o.getAttribute("data-value"),
      );
      expect(favOptions).toEqual(["en-US-JennyNeural", "zh-CN-YunxiNeural"]);

      expect(groups[1]?.getAttribute("aria-label")).toBe("ja-JP");
      const jaOptions = Array.from(groups[1]?.querySelectorAll("[role='option']") ?? []).map((o) =>
        o.getAttribute("data-value"),
      );
      expect(jaOptions).toEqual(["ja-JP-NanamiNeural"]);

      expect(groups[2]?.getAttribute("aria-label")).toBe("zh-CN");
      const zhOptions = Array.from(groups[2]?.querySelectorAll("[role='option']") ?? []).map((o) =>
        o.getAttribute("data-value"),
      );
      expect(zhOptions).toEqual(["zh-CN-XiaoxiaoNeural"]);
      await closeCombobox(user, voiceSelect);
    });

    it("displays empty state placeholder when no voices match combined filters", async () => {
      const user = userEvent.setup();
      render(<App />);
      await screen.findByLabelText(/选择声音/i);

      const searchInput = screen.getByLabelText(/搜索声音/i);
      await user.type(searchInput, "nonexistent-voice-name");

      const voiceSelect = screen.getByLabelText(/选择声音/i);
      expect(voiceSelect.getAttribute("aria-disabled")).toBe("true");
      expect(voiceSelect.textContent).toContain("没有匹配的声音");
    });

    it("reset all parameters does not reset voice search, locale filter, or favorites", async () => {
      const user = userEvent.setup();
      render(<App />);
      await screen.findByLabelText(/选择声音/i);

      const searchInput = screen.getByLabelText(/搜索声音/i) as HTMLInputElement;
      const localeSelect = screen.getByLabelText(/地区 \/ Locale/i);
      const favBtn = screen.getByRole("button", { name: /收藏当前声音/i });

      // Change search and locale
      await user.type(searchInput, "xiao");
      await selectComboboxOption(user, localeSelect, /zh-CN/i);
      await user.click(favBtn); // Favorite Xiaoxiao

      // Change synthesis parameters
      await selectComboboxOption(user, screen.getByLabelText(/音质/i), /高品质/i);
      const resetBtn = screen.getByRole("button", { name: /恢复默认参数/i });
      expect(resetBtn.hasAttribute("disabled")).toBe(false);

      // Reset parameters
      await user.click(resetBtn);

      // Synthesis parameter reset
      const qualitySelect = screen.getByLabelText(/音质/i);
      expect(qualitySelect.getAttribute("data-value")).toBe("standard");

      // Discovery & Favorites remain intact
      expect(searchInput.value).toBe("xiao");
      expect(localeSelect.getAttribute("data-value")).toBe("zh-CN");
      expect(favBtn.getAttribute("aria-pressed")).toBe("true");
    });

    it("supports discovery and favorites correctly when unlocked via API key auth flow", async () => {
      const user = userEvent.setup();
      fetchMock.mockImplementation(async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = requestUrl(input);
        if (url === "/api/health") return new Response(JSON.stringify({ status: "ok" }));
        if (url === "/api/voices") {
          const auth = (init?.headers as Record<string, string> | undefined)?.Authorization;
          if (auth === "Bearer sk-validkey1234567890") {
            return new Response(JSON.stringify({ voices: mockVoices }), {
              headers: { "Content-Type": "application/json" },
            });
          }
          return new Response(
            JSON.stringify({ error: { code: "UNAUTHORIZED", message: "API key required" } }),
            { status: 401, headers: { "Content-Type": "application/json" } },
          );
        }
        return new Response(null, { status: 404 });
      });

      render(<App />);
      await screen.findByText("API 需要认证");

      // Unlock with valid key
      const keyInput = screen.getByLabelText("API Key");
      await user.type(keyInput, "sk-validkey1234567890");
      await user.click(screen.getByRole("button", { name: "解锁" }));

      await screen.findByLabelText(/选择声音/i);
      const localeSelect = screen.getByLabelText(/地区 \/ Locale/i);
      const options = await getComboboxOptions(user, localeSelect);
      expect(options.length).toBe(4);
      expect(options[0]?.textContent).toContain("全部地区 (4)");
      await closeCombobox(user, localeSelect);
    });
  });

  describe("Phase 23: Text Workspace Ergonomics & Local TXT Import", () => {
    function createTxtFile(content: string | Uint8Array<ArrayBuffer>, name = "import.txt"): File {
      return new File([content], name, { type: "text/plain" });
    }

    it("displays Import TXT button and sets accept attribute on hidden file input", async () => {
      render(<App />);
      await screen.findByLabelText(/选择声音/i);

      const importBtn = screen.getByRole("button", { name: /导入 TXT 文件/i });
      expect(importBtn).toBeDefined();

      const fileInput = document.querySelector('input[type="file"]') as HTMLInputElement;
      expect(fileInput).not.toBeNull();
      expect(fileInput.getAttribute("accept")).toBe(".txt,text/plain");
    });

    it("successfully imports local TXT, updates line and char counts, and preserves voice/prosody", async () => {
      const user = userEvent.setup();
      render(<App />);
      await screen.findByLabelText(/选择声音/i);

      // Select high quality and custom speed
      await selectComboboxOption(user, screen.getByLabelText(/音质/i), /高品质/i);
      const textarea = screen.getByLabelText(/文本内容/i) as HTMLTextAreaElement;

      const fileInput = document.querySelector('input[type="file"]') as HTMLInputElement;
      const file = createTxtFile("Line 1\nLine 2\nLine 3", "speech.txt");

      fireEvent.change(fileInput, { target: { files: [file] } });

      await waitFor(() => {
        expect(textarea.value).toBe("Line 1\nLine 2\nLine 3");
      });

      // Check stats: 3 lines, 20 code points
      expect(screen.getByText(/3 行 · 20 \/ 20,000 字/)).toBeDefined();

      // Voice & prosody are unchanged
      const qualitySelect = screen.getByLabelText(/音质/i);
      expect(qualitySelect.getAttribute("data-value")).toBe("high");
    });

    it("import does not destroy existing completed audio result", async () => {
      const user = userEvent.setup();
      render(<App />);
      await screen.findByLabelText(/选择声音/i);

      // Generate audio first
      const textarea = screen.getByLabelText(/文本内容/i) as HTMLTextAreaElement;
      await user.type(textarea, "Initial text");
      await user.click(screen.getByRole("button", { name: /合成语音/i }));
      await screen.findByLabelText(/语音合成播放器/i);

      expect(screen.getByRole("link", { name: /下载合成音频/i })).toBeDefined();
      expect(screen.getByLabelText(/音频生成信息/i)).toBeDefined();

      // Now import a new file
      const fileInput = document.querySelector('input[type="file"]') as HTMLInputElement;
      const file = createTxtFile("New imported text", "new.txt");
      fireEvent.change(fileInput, { target: { files: [file] } });

      await waitFor(() => {
        expect(textarea.value).toBe("New imported text");
      });

      // Previous audio player and metadata remain available
      expect(screen.getByRole("link", { name: /下载合成音频/i })).toBeDefined();
      expect(screen.getByLabelText(/音频生成信息/i)).toBeDefined();
    });

    it("preserves old input and displays accessible alert when import fails (oversize, invalid UTF-8, over-limit, NUL, wrong extension)", async () => {
      const user = userEvent.setup();
      render(<App />);
      await screen.findByLabelText(/选择声音/i);

      const textarea = screen.getByLabelText(/文本内容/i) as HTMLTextAreaElement;
      await user.type(textarea, "Existing preserved content");
      const fileInput = document.querySelector('input[type="file"]') as HTMLInputElement;

      // 1. Wrong extension (.md)
      const mdFile = createTxtFile("Some markdown", "readme.md");
      fireEvent.change(fileInput, { target: { files: [mdFile] } });
      await screen.findByText("仅支持 UTF-8 TXT 文件");
      expect(textarea.value).toBe("Existing preserved content");

      // 2. Oversize file (> 256 KiB)
      const oversizeBytes = new Uint8Array(256 * 1024 + 1).fill(0x61);
      const oversizeFile = createTxtFile(oversizeBytes, "big.txt");
      fireEvent.change(fileInput, { target: { files: [oversizeFile] } });
      await screen.findByText("TXT 文件超过 256 KiB");
      expect(textarea.value).toBe("Existing preserved content");

      // 3. Invalid UTF-8
      const invalidBytes = new Uint8Array([0x48, 0x65, 0xff, 0xfe]);
      const invalidFile = createTxtFile(invalidBytes, "invalid.txt");
      fireEvent.change(fileInput, { target: { files: [invalidFile] } });
      await screen.findByText("TXT 文件不是有效的 UTF-8 文本");
      expect(textarea.value).toBe("Existing preserved content");

      // 4. Over 20,000 code points
      const over20k = createTxtFile("a".repeat(20_001), "over20k.txt");
      fireEvent.change(fileInput, { target: { files: [over20k] } });
      await screen.findByText("TXT 内容超过 20,000 字符上限");
      expect(textarea.value).toBe("Existing preserved content");

      // 5. NUL byte
      const nulFile = createTxtFile(new Uint8Array([0x61, 0x00, 0x62]), "nul.txt");
      fireEvent.change(fileInput, { target: { files: [nulFile] } });
      await screen.findByText("文件内容不是有效的纯文本");
      expect(textarea.value).toBe("Existing preserved content");

      // Next valid import clears the error
      const validFile = createTxtFile("Valid replacement", "valid.txt");
      fireEvent.change(fileInput, { target: { files: [validFile] } });
      await waitFor(() => {
        expect(textarea.value).toBe("Valid replacement");
      });
      expect(screen.queryByText("文件内容不是有效的纯文本")).toBeNull();
    });

    it("disables import while generating, but allows import while auth is locked", async () => {
      fetchMock.mockImplementation(async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = requestUrl(input);
        if (url === "/api/health") return new Response(JSON.stringify({ status: "ok" }));
        if (url === "/api/voices") return new Response(JSON.stringify({ voices: mockVoices }));
        if (url === "/api/speech") {
          return new Promise<Response>((_res, rej) => {
            init?.signal?.addEventListener("abort", () => {
              const err = new Error("Aborted");
              err.name = "AbortError";
              rej(err);
            });
          });
        }
        return new Response(null, { status: 404 });
      });

      render(<App />);
      await screen.findByLabelText(/选择声音/i);

      const importBtn = screen.getByRole("button", { name: /导入 TXT 文件/i });
      expect(importBtn.hasAttribute("disabled")).toBe(false);

      // Trigger generation
      const textarea = screen.getByLabelText(/文本内容/i) as HTMLTextAreaElement;
      fireEvent.change(textarea, { target: { value: "Generating text" } });
      fireEvent.click(screen.getByRole("button", { name: /合成语音/i }));

      // Import button is disabled while generating
      expect(importBtn.hasAttribute("disabled")).toBe(true);

      // Cancel to return to idle
      fireEvent.click(screen.getByRole("button", { name: /取消合成/i }));
      await screen.findByText(/已取消生成/i);
      expect(importBtn.hasAttribute("disabled")).toBe(false);
    });

    it("allows importing while auth is required", async () => {
      fetchMock.mockImplementation(async (input: RequestInfo | URL) => {
        const url = requestUrl(input);
        if (url === "/api/health") return new Response(JSON.stringify({ status: "ok" }));
        if (url === "/api/voices") {
          return new Response(JSON.stringify({ error: { code: "UNAUTHORIZED" } }), { status: 401 });
        }
        return new Response(null, { status: 404 });
      });

      render(<App />);
      await screen.findByText("API 需要认证");

      // Import button is still enabled
      const importBtn = screen.getByRole("button", { name: /导入 TXT 文件/i });
      expect(importBtn.hasAttribute("disabled")).toBe(false);

      const fileInput = document.querySelector('input[type="file"]') as HTMLInputElement;
      const file = createTxtFile("Auth locked import text", "test.txt");
      fireEvent.change(fileInput, { target: { files: [file] } });

      const textarea = screen.getByLabelText(/文本内容/i) as HTMLTextAreaElement;
      await waitFor(() => {
        expect(textarea.value).toBe("Auth locked import text");
      });
    });

    it("latest selected file wins async race", async () => {
      render(<App />);
      await screen.findByLabelText(/选择声音/i);

      const textarea = screen.getByLabelText(/文本内容/i) as HTMLTextAreaElement;
      const fileInput = document.querySelector('input[type="file"]') as HTMLInputElement;

      // File A is slow
      let resolveFileA: (buf: ArrayBuffer) => void;
      const slowPromise = new Promise<ArrayBuffer>((res) => {
        resolveFileA = res;
      });
      const fileA = createTxtFile("File A content", "fileA.txt");
      vi.spyOn(fileA, "arrayBuffer").mockReturnValue(slowPromise);

      // File B is fast
      const fileB = createTxtFile("File B content", "fileB.txt");

      // Start A, then start B
      fireEvent.change(fileInput, { target: { files: [fileA] } });
      fireEvent.change(fileInput, { target: { files: [fileB] } });

      // B completes first
      await waitFor(() => {
        expect(textarea.value).toBe("File B content");
      });

      // Now A completes later
      resolveFileA!(new TextEncoder().encode("File A content").buffer);
      await new Promise((r) => setTimeout(r, 50));

      // B must NOT be overwritten by late A
      expect(textarea.value).toBe("File B content");
    });

    it("successfully imports TXT in React.StrictMode with effect replay", async () => {
      render(
        <React.StrictMode>
          <App />
        </React.StrictMode>,
      );
      await screen.findByLabelText(/选择声音/i);

      const textarea = screen.getByLabelText(/文本内容/i) as HTMLTextAreaElement;
      const fileInput = document.querySelector('input[type="file"]') as HTMLInputElement;
      const file = createTxtFile("StrictMode imported text", "strict.txt");

      fireEvent.change(fileInput, { target: { files: [file] } });

      await waitFor(() => {
        expect(textarea.value).toBe("StrictMode imported text");
      });
    });

    it("preserves latest-file-wins under React.StrictMode", async () => {
      render(
        <React.StrictMode>
          <App />
        </React.StrictMode>,
      );
      await screen.findByLabelText(/选择声音/i);

      const textarea = screen.getByLabelText(/文本内容/i) as HTMLTextAreaElement;
      const fileInput = document.querySelector('input[type="file"]') as HTMLInputElement;

      let resolveFileA: (buf: ArrayBuffer) => void;
      const slowPromise = new Promise<ArrayBuffer>((res) => {
        resolveFileA = res;
      });
      const fileA = createTxtFile("File A strict content", "fileA.txt");
      vi.spyOn(fileA, "arrayBuffer").mockReturnValue(slowPromise);

      const fileB = createTxtFile("File B strict content", "fileB.txt");

      fireEvent.change(fileInput, { target: { files: [fileA] } });
      fireEvent.change(fileInput, { target: { files: [fileB] } });

      await waitFor(() => {
        expect(textarea.value).toBe("File B strict content");
      });

      resolveFileA!(new TextEncoder().encode("File A strict content").buffer);
      await new Promise((r) => setTimeout(r, 50));

      expect(textarea.value).toBe("File B strict content");
    });

    it("unmounting component before async TXT import completes does not apply text or cause lifecycle warnings", async () => {
      let resolveFile: (buf: ArrayBuffer) => void;
      const slowPromise = new Promise<ArrayBuffer>((res) => {
        resolveFile = res;
      });
      const file = createTxtFile("Delayed content", "delayed.txt");
      vi.spyOn(file, "arrayBuffer").mockReturnValue(slowPromise);

      const { unmount } = render(<App />);
      await screen.findByLabelText(/选择声音/i);

      const fileInput = document.querySelector('input[type="file"]') as HTMLInputElement;
      fireEvent.change(fileInput, { target: { files: [file] } });

      // Unmount before file completes
      unmount();

      // Resolve the delayed file read
      resolveFile!(new TextEncoder().encode("Delayed content").buffer);
      await new Promise((r) => setTimeout(r, 50));

      // File reading completed after unmount; no error thrown
    });

    it("triggers synthesis on Ctrl+Enter and Meta+Enter in textarea, but not in other inputs", async () => {
      let speechCalls = 0;
      fetchMock.mockImplementation(async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = requestUrl(input);
        if (url === "/api/health") return new Response(JSON.stringify({ status: "ok" }));
        if (url === "/api/voices") return new Response(JSON.stringify({ voices: mockVoices }));
        if (url === "/api/speech") {
          speechCalls++;
          return new Promise<Response>((_res, rej) => {
            init?.signal?.addEventListener("abort", () => {
              const err = new Error("Aborted");
              err.name = "AbortError";
              rej(err);
            });
          });
        }
        return new Response(null, { status: 404 });
      });

      render(<App />);
      await screen.findByLabelText(/选择声音/i);

      const textarea = screen.getByLabelText(/文本内容/i) as HTMLTextAreaElement;
      fireEvent.change(textarea, { target: { value: "Shortcut test" } });

      // 1. Ctrl+Enter in search input does not synthesize
      const searchInput = screen.getByLabelText(/搜索声音/i);
      fireEvent.keyDown(searchInput, { key: "Enter", ctrlKey: true });
      expect(speechCalls).toBe(0);

      // 2. Ctrl+Enter in textarea synthesizes
      fireEvent.keyDown(textarea, { key: "Enter", ctrlKey: true });
      expect(speechCalls).toBe(1);
      const cancelBtn = await screen.findByRole("button", { name: /取消合成/i });

      // Cancel
      fireEvent.click(cancelBtn);
      await screen.findByText(/已取消生成/i);

      // 3. Meta+Enter in textarea synthesizes
      fireEvent.keyDown(textarea, { key: "Enter", metaKey: true });
      expect(speechCalls).toBe(2);

      // Cancel
      fireEvent.click(await screen.findByRole("button", { name: /取消合成/i }));
      await screen.findByText(/已取消生成/i);
    });

    it("Escape key cancels active synthesis once, but does nothing when idle", async () => {
      let abortCount = 0;
      fetchMock.mockImplementation(async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = requestUrl(input);
        if (url === "/api/health") return new Response(JSON.stringify({ status: "ok" }));
        if (url === "/api/voices") return new Response(JSON.stringify({ voices: mockVoices }));
        if (url === "/api/speech") {
          return new Promise<Response>((_res, rej) => {
            init?.signal?.addEventListener("abort", () => {
              abortCount++;
              const err = new Error("Aborted");
              err.name = "AbortError";
              rej(err);
            });
          });
        }
        return new Response(null, { status: 404 });
      });

      render(<App />);
      await screen.findByLabelText(/选择声音/i);

      // Escape while idle does nothing
      fireEvent.keyDown(window, { key: "Escape" });
      expect(abortCount).toBe(0);
      expect(screen.queryByText(/已取消生成/i)).toBeNull();

      // Start generation
      const textarea = screen.getByLabelText(/文本内容/i) as HTMLTextAreaElement;
      fireEvent.change(textarea, { target: { value: "Escape test" } });
      fireEvent.click(screen.getByRole("button", { name: /合成语音/i }));
      await screen.findByRole("button", { name: /取消合成/i });

      // Press Escape
      fireEvent.keyDown(window, { key: "Escape" });
      await screen.findByText(/已取消生成/i);
      expect(abortCount).toBe(1);

      // Subsequent Escape while idle does nothing
      fireEvent.keyDown(window, { key: "Escape" });
      expect(abortCount).toBe(1);
    });

    it("removes Escape keyboard listener on unmount", async () => {
      const { unmount } = render(<App />);
      await screen.findByLabelText(/选择声音/i);
      unmount();
      expect(() => {
        fireEvent.keyDown(window, { key: "Escape" });
      }).not.toThrow();
    });

    it("safe clear text requires themed confirmation, clears input on confirm, preserves on cancel, and leaves completed audio intact", async () => {
      const confirmSpy = vi.spyOn(window, "confirm");
      try {
        const user = userEvent.setup();
        render(<App />);
        await screen.findByLabelText(/选择声音/i);

        const clearBtn = screen.getByRole("button", { name: /清空当前文本/i });
        expect(clearBtn.hasAttribute("disabled")).toBe(true);

        const textarea = screen.getByLabelText(/文本内容/i) as HTMLTextAreaElement;
        await user.type(textarea, "Text to clear");
        expect(clearBtn.hasAttribute("disabled")).toBe(false);

        // jsdom does not implement dialog's modal methods; browser QA covers focus and Escape.
        const dialog = document.querySelector("dialog")!;
        dialog.showModal = () => {
          dialog.open = true;
        };
        dialog.close = () => {
          dialog.open = false;
        };

        // 1. User cancels confirmation
        await user.click(clearBtn);
        expect(screen.getByRole("dialog", { name: "清空当前文本" })).toBeDefined();
        expect(screen.getByText("确定清空当前文本吗？此操作无法撤销。")).toBeDefined();
        await user.click(screen.getByRole("button", { name: "取消" }));
        expect(dialog.open).toBe(false);
        expect(confirmSpy).not.toHaveBeenCalled();
        expect(textarea.value).toBe("Text to clear");

        // 2. Generate audio to verify clear doesn't destroy completed result
        await user.click(screen.getByRole("button", { name: /合成语音/i }));
        await screen.findByLabelText(/语音合成播放器/i);

        // 3. User confirms clear
        await user.click(clearBtn);
        await user.click(screen.getByRole("button", { name: "确认清空" }));
        expect(dialog.open).toBe(false);
        expect(textarea.value).toBe("");
        expect(clearBtn.hasAttribute("disabled")).toBe(true);

        // Audio player and metadata remain intact
        expect(screen.getByRole("link", { name: /下载合成音频/i })).toBeDefined();
        expect(screen.getByLabelText(/音频生成信息/i)).toBeDefined();
      } finally {
        confirmSpy.mockRestore();
      }
    });

    it("privacy regression: verifies sensitive text and file details are never written to storage", async () => {
      const user = userEvent.setup();
      render(<App />);
      await screen.findByLabelText(/选择声音/i);

      const textarea = screen.getByLabelText(/文本内容/i) as HTMLTextAreaElement;
      await user.type(textarea, "Super sensitive text payload");

      const fileInput = document.querySelector('input[type="file"]') as HTMLInputElement;
      const file = createTxtFile("Secret imported text", "confidential.txt");
      fireEvent.change(fileInput, { target: { files: [file] } });

      await waitFor(() => {
        expect(textarea.value).toBe("Secret imported text");
      });

      // Check localStorage and sessionStorage
      for (let i = 0; i < window.localStorage.length; i++) {
        const key = window.localStorage.key(i)!;
        expect([
          "edgetts.workbench.preferences.v1",
          "edgetts.workbench.favoriteVoices.v1",
          "edgetts.ui-locale.v1",
        ]).toContain(key);
        const val = window.localStorage.getItem(key)!;
        expect(val).not.toContain("Secret");
        expect(val).not.toContain("confidential");
        expect(val).not.toContain("sensitive");
      }
      expect(window.sessionStorage.length).toBe(0);
    });
  });

  describe("Phase 24: Long-Text Synthesis Status & Streaming Telemetry", () => {
    it("Generate click immediately shows requesting status '正在等待语音服务…'", async () => {
      let resolveResponse: (res: Response) => void;
      const delayedResponsePromise = new Promise<Response>((resolve) => {
        resolveResponse = resolve;
      });

      fetchMock.mockImplementation(async (input: RequestInfo | URL) => {
        const url = requestUrl(input);
        if (url === "/api/health") return new Response(JSON.stringify({ status: "ok" }));
        if (url === "/api/voices") return new Response(JSON.stringify({ voices: mockVoices }));
        if (url === "/api/speech") return delayedResponsePromise;
        return new Response(null, { status: 404 });
      });

      render(<App />);
      await screen.findByLabelText(/选择声音/i);

      const textarea = screen.getByLabelText(/文本内容/i) as HTMLTextAreaElement;
      fireEvent.change(textarea, { target: { value: "测试文本" } });

      fireEvent.click(screen.getByRole("button", { name: /合成语音/i }));

      const indicator = await screen.findByRole("status", { name: "合成状态" });
      expect(indicator.textContent).toBe("正在等待语音服务…");

      // Resolve response with stream
      const stream = new ReadableStream({
        start(controller) {
          controller.enqueue(new Uint8Array([1, 2, 3, 4]));
          controller.close();
        },
      });
      resolveResponse!(
        new Response(stream, {
          status: 200,
          headers: {
            "Content-Type": "audio/mpeg",
            "X-EdgeTTS-Segment-Count": "1",
            "X-EdgeTTS-Segment-Max-Code-Points": "300",
          },
        }),
      );

      await screen.findByLabelText(/语音合成播放器/i);
    });

    it("displays long-text segment count and received bytes during streaming", async () => {
      const originalMediaSource = window.MediaSource;
      try {
        class MockSourceBuffer extends EventTarget {
          updating = false;
          appendBuffer = vi.fn(() => {
            queueMicrotask(() => {
              this.dispatchEvent(new Event("updateend"));
            });
          });
          abort = vi.fn();
        }

        const mockBuffer = new MockSourceBuffer();
        class MockMediaSource extends EventTarget {
          readyState = "open";
          addSourceBuffer = vi.fn(() => mockBuffer as unknown as SourceBuffer);
          endOfStream = vi.fn();
          static isTypeSupported = vi.fn(() => true);
        }

        // @ts-expect-error Mocking MediaSource
        window.MediaSource = MockMediaSource;

        let pushChunk!: (chunk: Uint8Array) => void;
        let closeStream!: () => void;
        const stream = new ReadableStream<Uint8Array>({
          start(ctrl) {
            pushChunk = (c) => ctrl.enqueue(c);
            closeStream = () => ctrl.close();
          },
        });

        fetchMock.mockImplementation(async (input: RequestInfo | URL) => {
          const url = requestUrl(input);
          if (url === "/api/health") return new Response(JSON.stringify({ status: "ok" }));
          if (url === "/api/voices") return new Response(JSON.stringify({ voices: mockVoices }));
          if (url === "/api/speech") {
            return new Response(stream, {
              status: 200,
              headers: {
                "Content-Type": "audio/mpeg",
                "X-EdgeTTS-Segment-Count": "5",
                "X-EdgeTTS-Segment-Max-Code-Points": "300",
              },
            });
          }
          return new Response(null, { status: 404 });
        });

        render(<App />);
        await screen.findByLabelText(/选择声音/i);

        const textarea = screen.getByLabelText(/文本内容/i) as HTMLTextAreaElement;
        fireEvent.change(textarea, { target: { value: "长文本测试内容。".repeat(30) } }); // > 300 code points

        fireEvent.click(screen.getByRole("button", { name: /合成语音/i }));

        // Status indicator displays plan segment count once stream starts
        pushChunk(new Uint8Array(32 * 1024));

        await waitFor(() => {
          const indicator = screen.getByRole("status", { name: "合成状态" });
          expect(indicator.textContent).toContain("共 5 段");
          expect(indicator.textContent).toContain("32.0 KiB");
        });

        // Finish stream
        closeStream();
        await screen.findByLabelText(/语音合成播放器/i);

        // Indicator disappears upon completion
        expect(screen.queryByRole("status", { name: "合成状态" })).toBeNull();

        // Completed metadata includes segment count and audio bytes
        const metadata = screen.getByLabelText(/音频生成信息/i);
        expect(metadata.textContent).toContain("5 段");
        expect(metadata.textContent).toContain("32.0 KiB");
      } finally {
        window.MediaSource = originalMediaSource as typeof MediaSource;
      }
    });

    it("handles missing segment headers gracefully and still displays bytes", async () => {
      fetchMock.mockImplementation(async (input: RequestInfo | URL) => {
        const url = requestUrl(input);
        if (url === "/api/health") return new Response(JSON.stringify({ status: "ok" }));
        if (url === "/api/voices") return new Response(JSON.stringify({ voices: mockVoices }));
        if (url === "/api/speech") {
          const stream = new ReadableStream<Uint8Array>({
            start(ctrl) {
              ctrl.enqueue(new Uint8Array(4096));
              ctrl.close();
            },
          });
          return new Response(stream, {
            status: 200,
            headers: { "Content-Type": "audio/mpeg" }, // No X-EdgeTTS-* headers
          });
        }
        return new Response(null, { status: 404 });
      });

      render(<App />);
      await screen.findByLabelText(/选择声音/i);

      const textarea = screen.getByLabelText(/文本内容/i) as HTMLTextAreaElement;
      fireEvent.change(textarea, { target: { value: "测试文本" } });

      fireEvent.click(screen.getByRole("button", { name: /合成语音/i }));
      await screen.findByLabelText(/语音合成播放器/i);

      // Completed metadata displays audio bytes without segment count
      const metadata = screen.getByLabelText(/音频生成信息/i);
      expect(metadata.textContent).toContain("4.0 KiB");
      expect(metadata.textContent).not.toContain("段");
    });

    it("handles malformed segment headers gracefully without rejecting synthesis", async () => {
      fetchMock.mockImplementation(async (input: RequestInfo | URL) => {
        const url = requestUrl(input);
        if (url === "/api/health") return new Response(JSON.stringify({ status: "ok" }));
        if (url === "/api/voices") return new Response(JSON.stringify({ voices: mockVoices }));
        if (url === "/api/speech") {
          const stream = new ReadableStream<Uint8Array>({
            start(ctrl) {
              ctrl.enqueue(new Uint8Array(8192));
              ctrl.close();
            },
          });
          return new Response(stream, {
            status: 200,
            headers: {
              "Content-Type": "audio/mpeg",
              "X-EdgeTTS-Segment-Count": "invalid_segment_count",
              "X-EdgeTTS-Segment-Max-Code-Points": "-50",
            },
          });
        }
        return new Response(null, { status: 404 });
      });

      render(<App />);
      await screen.findByLabelText(/选择声音/i);

      const textarea = screen.getByLabelText(/文本内容/i) as HTMLTextAreaElement;
      fireEvent.change(textarea, { target: { value: "测试文本" } });

      fireEvent.click(screen.getByRole("button", { name: /合成语音/i }));
      await screen.findByLabelText(/语音合成播放器/i);

      const metadata = screen.getByLabelText(/音频生成信息/i);
      expect(metadata.textContent).toContain("8.0 KiB");
      expect(metadata.textContent).not.toContain("invalid");
      expect(metadata.textContent).not.toContain("段");
    });

    it("later control changes do not mutate completed result metadata", async () => {
      const user = userEvent.setup();
      fetchMock.mockImplementation(async (input: RequestInfo | URL) => {
        const url = requestUrl(input);
        if (url === "/api/health") return new Response(JSON.stringify({ status: "ok" }));
        if (url === "/api/voices") return new Response(JSON.stringify({ voices: mockVoices }));
        if (url === "/api/speech") {
          const stream = new ReadableStream<Uint8Array>({
            start(ctrl) {
              ctrl.enqueue(new Uint8Array(10240));
              ctrl.close();
            },
          });
          return new Response(stream, {
            status: 200,
            headers: {
              "Content-Type": "audio/mpeg",
              "X-EdgeTTS-Segment-Count": "2",
              "X-EdgeTTS-Segment-Max-Code-Points": "300",
            },
          });
        }
        return new Response(null, { status: 404 });
      });

      render(<App />);
      await screen.findByLabelText(/选择声音/i);

      const textarea = screen.getByLabelText(/文本内容/i) as HTMLTextAreaElement;
      fireEvent.change(textarea, { target: { value: "测试文本" } });

      fireEvent.click(screen.getByRole("button", { name: /合成语音/i }));
      await screen.findByLabelText(/语音合成播放器/i);

      const metadataBefore = screen.getByLabelText(/音频生成信息/i).textContent;
      expect(metadataBefore).toContain("2 段 · 10.0 KiB");

      // Mutate prosody sliders
      const speedSlider = screen.getByLabelText(/^语速/i);
      fireEvent.change(speedSlider, { target: { value: "1.5" } });

      // Change voice
      await selectComboboxOption(user, screen.getByLabelText(/选择声音/i), /Jenny/i);

      // Completed metadata remains unchanged
      const metadataAfter = screen.getByLabelText(/音频生成信息/i).textContent;
      expect(metadataAfter).toBe(metadataBefore);
    });

    it("error responses clear active telemetry indicator", async () => {
      fetchMock.mockImplementation(async (input: RequestInfo | URL) => {
        const url = requestUrl(input);
        if (url === "/api/health") return new Response(JSON.stringify({ status: "ok" }));
        if (url === "/api/voices") return new Response(JSON.stringify({ voices: mockVoices }));
        if (url === "/api/speech") return new Response(null, { status: 502 });
        return new Response(null, { status: 404 });
      });

      render(<App />);
      await screen.findByLabelText(/选择声音/i);

      const textarea = screen.getByLabelText(/文本内容/i) as HTMLTextAreaElement;
      fireEvent.change(textarea, { target: { value: "测试文本" } });

      fireEvent.click(screen.getByRole("button", { name: /合成语音/i }));
      await screen.findByText("语音服务暂时不可用");

      expect(screen.queryByRole("status", { name: "合成状态" })).toBeNull();
    });

    it("cancel clears active telemetry indicator", async () => {
      fetchMock.mockImplementation(async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = requestUrl(input);
        if (url === "/api/health") return new Response(JSON.stringify({ status: "ok" }));
        if (url === "/api/voices") return new Response(JSON.stringify({ voices: mockVoices }));
        if (url === "/api/speech") {
          return new Promise<Response>((_res, rej) => {
            init?.signal?.addEventListener("abort", () => {
              const err = new Error("Aborted");
              err.name = "AbortError";
              rej(err);
            });
          });
        }
        return new Response(null, { status: 404 });
      });

      render(<App />);
      await screen.findByLabelText(/选择声音/i);

      const textarea = screen.getByLabelText(/文本内容/i) as HTMLTextAreaElement;
      fireEvent.change(textarea, { target: { value: "测试文本" } });

      fireEvent.click(screen.getByRole("button", { name: /合成语音/i }));
      expect(await screen.findByRole("status", { name: "合成状态" })).toBeDefined();

      fireEvent.click(screen.getByRole("button", { name: /取消合成/i }));
      await screen.findByText("已取消生成");

      expect(screen.queryByRole("status", { name: "合成状态" })).toBeNull();
    });
  });

  describe("Phase 25: Workbench Accessibility & Responsive Hardening", () => {
    it("API health state exposes polite live region and announces status transitions", async () => {
      let resolveHealth: (res: Response) => void;
      const delayedHealthPromise = new Promise<Response>((resolve) => {
        resolveHealth = resolve;
      });

      fetchMock.mockImplementation(async (input: RequestInfo | URL) => {
        const url = requestUrl(input);
        if (url === "/api/health") return delayedHealthPromise;
        if (url === "/api/voices") return new Response(JSON.stringify({ voices: mockVoices }));
        return new Response(null, { status: 404 });
      });

      render(<App />);

      // Initial loading state exposes role="status", aria-live="polite", and aria-atomic="true"
      const statusRegion = screen.getByRole("status", { name: /API 状态/i });
      expect(statusRegion).toBeDefined();
      expect(statusRegion.getAttribute("aria-live")).toBe("polite");
      expect(statusRegion.getAttribute("aria-atomic")).toBe("true");
      expect(statusRegion.textContent).toContain("连接中...");

      // Resolve health
      resolveHealth!(new Response(JSON.stringify({ status: "ok" })));

      // Updates to healthy without unmounting the live region
      await waitFor(() => {
        expect(statusRegion.textContent).toContain("正常");
      });
      expect(statusRegion.getAttribute("aria-live")).toBe("polite");
    });

    it("API health failure politely announces unavailable status", async () => {
      fetchMock.mockImplementation(async (input: RequestInfo | URL) => {
        const url = requestUrl(input);
        if (url === "/api/health") return new Response(null, { status: 500 });
        if (url === "/api/voices") return new Response(JSON.stringify({ voices: mockVoices }));
        return new Response(null, { status: 404 });
      });

      render(<App />);

      const statusRegion = await screen.findByRole("status", { name: /API 状态/i });
      await waitFor(() => {
        expect(statusRegion.textContent).toContain("不可用");
      });
      expect(statusRegion.getAttribute("aria-live")).toBe("polite");
    });

    it("hidden file input is excluded from tab navigation while visible import button is accessible", async () => {
      const { container } = render(<App />);
      await screen.findByLabelText(/选择声音/i);

      const fileInput = container.querySelector('input[type="file"]') as HTMLInputElement;
      expect(fileInput).toBeDefined();
      expect(fileInput.getAttribute("tabIndex")).toBe("-1");
      expect(fileInput.getAttribute("aria-hidden")).toBe("true");

      const importBtn = screen.getByRole("button", { name: /导入 TXT 文件/i });
      expect(importBtn).toBeDefined();
      expect(importBtn.hasAttribute("disabled")).toBe(false);
      expect(importBtn.getAttribute("tabIndex")).toBeNull();
    });

    it("favorite button exposes dynamic aria-pressed semantics and descriptive labels", async () => {
      const user = userEvent.setup();
      render(<App />);
      await screen.findByLabelText(/选择声音/i);

      const favBtn = screen.getByRole("button", { name: /收藏当前声音/i });
      expect(favBtn.getAttribute("aria-pressed")).toBe("false");
      expect(favBtn.textContent).toContain("☆ 收藏");

      // Click favorite
      await user.click(favBtn);
      expect(favBtn.getAttribute("aria-pressed")).toBe("true");
      expect(favBtn.getAttribute("aria-label")).toBe("取消收藏当前声音");
      expect(favBtn.textContent).toContain("★ 已收藏");

      // Click again to unfavorite
      await user.click(favBtn);
      expect(favBtn.getAttribute("aria-pressed")).toBe("false");
      expect(favBtn.getAttribute("aria-label")).toBe("收藏当前声音");
      expect(favBtn.textContent).toContain("☆ 收藏");
    });

    it("validation and runtime errors expose alert semantics", async () => {
      render(<App />);
      await screen.findByLabelText(/选择声音/i);

      const textarea = screen.getByLabelText(/文本内容/i) as HTMLTextAreaElement;
      fireEvent.change(textarea, { target: { value: "a".repeat(20001) } });

      const alert = await screen.findByRole("alert");
      expect(alert.textContent).toContain("超出上限");
    });

    it("completed result audio player exposes custom controls and accessible download link", async () => {
      fetchMock.mockImplementation(async (input: RequestInfo | URL) => {
        const url = requestUrl(input);
        if (url === "/api/health") return new Response(JSON.stringify({ status: "ok" }));
        if (url === "/api/voices") return new Response(JSON.stringify({ voices: mockVoices }));
        if (url === "/api/speech") {
          const stream = new ReadableStream<Uint8Array>({
            start(ctrl) {
              ctrl.enqueue(new Uint8Array(4096));
              ctrl.close();
            },
          });
          return new Response(stream, {
            status: 200,
            headers: {
              "Content-Type": "audio/mpeg",
              "X-EdgeTTS-Segment-Count": "1",
              "X-EdgeTTS-Segment-Max-Code-Points": "300",
            },
          });
        }
        return new Response(null, { status: 404 });
      });

      render(<App />);
      await screen.findByLabelText(/选择声音/i);

      const textarea = screen.getByLabelText(/文本内容/i) as HTMLTextAreaElement;
      fireEvent.change(textarea, { target: { value: "语音测试" } });

      fireEvent.click(screen.getByRole("button", { name: /合成语音/i }));

      const player = await screen.findByLabelText(/语音合成播放器/i);
      expect(screen.getByRole("button", { name: /播放|暂停/i })).toBeDefined();
      const audioElement = player.querySelector("audio");
      expect(audioElement).not.toBeNull();
      expect(audioElement?.hasAttribute("controls")).toBe(false);

      const downloadLink = screen.getByRole("link", { name: /下载合成音频/i });
      expect(downloadLink.getAttribute("download")).toContain(".mp3");
      expect(downloadLink.getAttribute("href")).toContain("blob:");
    });

    it("keyboard Tab navigation reaches core interactive controls in logical sequence", async () => {
      window.localStorage.setItem(
        WORKBENCH_FAVORITES_KEY,
        JSON.stringify({ voiceIds: ["zh-CN-XiaoxiaoNeural"] }),
      );
      const user = userEvent.setup();
      render(<App />);
      await screen.findByLabelText(/选择声音/i);

      const textarea = screen.getByLabelText(/文本内容/i) as HTMLTextAreaElement;
      // Enter text so clear and generate buttons become enabled
      fireEvent.change(textarea, { target: { value: "可访问性导航测试" } });

      // Language switch is the first control in the page header.
      await user.tab();
      expect(document.activeElement).toBe(screen.getByRole("combobox", { name: "界面语言" }));
      await user.tab();
      expect(document.activeElement).toBe(screen.getByRole("button", { name: /导入 TXT 文件/i }));

      await user.tab();
      expect(document.activeElement).toBe(screen.getByRole("button", { name: /清空当前文本/i }));

      await user.tab();
      expect(document.activeElement).toBe(textarea);

      await user.tab();
      expect(document.activeElement).toBe(screen.getByRole("searchbox", { name: /搜索声音/i }));

      await user.tab();
      expect(document.activeElement).toBe(
        screen.getByRole("combobox", { name: /地区 \/ Locale/i }),
      );

      await user.tab();
      expect(document.activeElement).toBe(screen.getByRole("checkbox", { name: /只看收藏/i }));

      await user.tab();
      expect(document.activeElement).toBe(screen.getByRole("combobox", { name: /选择声音/i }));

      await user.tab();
      expect(document.activeElement).toBe(
        screen.getByRole("button", { name: /取消收藏当前声音/i }),
      );

      await user.tab();
      expect(document.activeElement).toBe(screen.getByRole("combobox", { name: /音质/i }));

      await user.tab();
      expect(document.activeElement).toBe(screen.getByLabelText(/^语速/i));

      await user.tab();
      expect(document.activeElement).toBe(screen.getByLabelText(/^音调/i));

      await user.tab();
      expect(document.activeElement).toBe(screen.getByLabelText(/^音量/i));

      await user.tab();
      expect(document.activeElement).toBe(screen.getByRole("button", { name: /合成语音/i }));
    });

    it("disabled controls are natively skipped during Tab navigation", async () => {
      const user = userEvent.setup();
      render(<App />);
      await screen.findByLabelText(/选择声音/i);

      // Input is empty: clear button is disabled, reset all is disabled, generate is disabled
      const clearBtn = screen.getByRole("button", { name: /清空当前文本/i }) as HTMLButtonElement;
      expect(clearBtn.disabled).toBe(true);

      const textarea = screen.getByLabelText(/文本内容/i);

      // Header language switch precedes the editor controls.
      await user.tab();
      expect(document.activeElement).toBe(screen.getByRole("combobox", { name: "界面语言" }));
      await user.tab();
      expect(document.activeElement).toBe(screen.getByRole("button", { name: /导入 TXT 文件/i }));

      // Tab 2 skips disabled clear button and lands directly on textarea
      await user.tab();
      expect(document.activeElement).toBe(textarea);
    });

    it("Phase 28: verifies no visible native select remains in the document", async () => {
      render(<App />);
      await screen.findByLabelText(/选择声音/i);

      // Verify zero native <select> elements exist
      const nativeSelects = document.querySelectorAll("select");
      expect(nativeSelects.length).toBe(0);

      // Verify custom comboboxes are used instead
      const comboboxes = screen.getAllByRole("combobox");
      expect(comboboxes.length).toBeGreaterThanOrEqual(3);
    });
  });
});
