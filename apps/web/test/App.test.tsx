import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, waitFor, fireEvent, cleanup } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { VoiceDto } from "@edgetts/shared";
import { App } from "../src/App.js";

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

describe("EdgeTTS Web Workbench", () => {
  let createdUrls: string[] = [];
  let revokedUrls: string[] = [];
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
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
    fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = typeof input === "string" ? input : input.toString();

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
        const url = typeof input === "string" ? input : input.toString();
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
        const url = typeof input === "string" ? input : input.toString();
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
        const url = typeof input === "string" ? input : input.toString();
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
    it("filters voices by displayName, voice id, and locale case-insensitively", async () => {
      const user = userEvent.setup();
      render(<App />);

      await screen.findByLabelText(/选择声音/i);
      const searchInput = screen.getByLabelText(/搜索声音/i);

      // Search by displayName "Jenny"
      await user.type(searchInput, "jenny");
      const select = screen.getByLabelText(/选择声音/i) as HTMLSelectElement;
      expect(select.options.length).toBe(1);
      expect(select.options[0]?.value).toBe("en-US-JennyNeural");

      // Search by locale "ja-jp"
      await user.clear(searchInput);
      await user.type(searchInput, "ja-jp");
      expect(select.options.length).toBe(1);
      expect(select.options[0]?.value).toBe("ja-JP-NanamiNeural");

      // Search by partial id "xiaoxiao"
      await user.clear(searchInput);
      await user.type(searchInput, "xiaoxiao");
      expect(select.options.length).toBe(1);
      expect(select.options[0]?.value).toBe("zh-CN-XiaoxiaoNeural");
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
      await user.selectOptions(qualitySelect, "high");

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
      expect(downloadLink.getAttribute("download")).toBe("speech.mp3");
    });

    it("aborts active synthesis when Cancel button is clicked", async () => {
      const user = userEvent.setup();

      // Create a deferred speech request that remains pending
      fetchMock.mockImplementation(async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = typeof input === "string" ? input : input.toString();
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
        const url = typeof input === "string" ? input : input.toString();
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
        const url = typeof input === "string" ? input : input.toString();
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
        const url = typeof input === "string" ? input : input.toString();
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
        const url = typeof input === "string" ? input : input.toString();
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
        const url = typeof input === "string" ? input : input.toString();
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
        const url = typeof input === "string" ? input : input.toString();
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
        const url = typeof input === "string" ? input : input.toString();
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
        const url = typeof input === "string" ? input : input.toString();
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
        const url = typeof input === "string" ? input : input.toString();
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
        const url = typeof input === "string" ? input : input.toString();
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
        const url = typeof input === "string" ? input : input.toString();
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
        const url = typeof input === "string" ? input : input.toString();
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
});
