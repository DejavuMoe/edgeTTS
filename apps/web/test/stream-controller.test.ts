import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { StreamPlaybackController } from "../src/audio/stream-controller.js";

describe("StreamPlaybackController Session Isolation & URL Lifecycle", () => {
  let originalMediaSource: unknown;
  let originalCreateObjectURL: (obj: Blob | MediaSource) => string;
  let originalRevokeObjectURL: (url: string) => void;
  let revokedUrls: string[];

  beforeEach(() => {
    revokedUrls = [];
    originalMediaSource = window.MediaSource;
    originalCreateObjectURL = URL.createObjectURL;
    originalRevokeObjectURL = URL.revokeObjectURL;

    let urlCounter = 0;
    URL.createObjectURL = vi.fn(() => {
      return `blob:mock-url-${++urlCounter}`;
    });

    URL.revokeObjectURL = vi.fn((url: string) => {
      revokedUrls.push(url);
    });
  });

  afterEach(() => {
    window.MediaSource = originalMediaSource as typeof MediaSource;
    URL.createObjectURL = originalCreateObjectURL;
    URL.revokeObjectURL = originalRevokeObjectURL;
  });

  it("revokes single fallback blob URL exactly once", async () => {
    // Disable MediaSource to force fallback
    // @ts-expect-error Mocking window.MediaSource
    delete window.MediaSource;

    const controller = new StreamPlaybackController();
    const mockBlob = new Blob(["test"], { type: "audio/mpeg" });
    const mockResponse = {
      blob: vi.fn(async () => mockBlob),
    } as unknown as Response;

    const callbacks = {
      onStreamReady: vi.fn(),
      onDownloadReady: vi.fn(),
      onError: vi.fn(),
      onFinish: vi.fn(),
    };

    const ac = new AbortController();
    await controller.startStream(mockResponse, ac.signal, callbacks);

    expect(callbacks.onStreamReady).toHaveBeenCalledWith("blob:mock-url-1");
    expect(callbacks.onDownloadReady).toHaveBeenCalledWith("blob:mock-url-1");
    expect(revokedUrls).toHaveLength(0);

    // Now cleanup/cancel
    controller.cleanup();

    // Exactly once revocation
    expect(revokedUrls).toEqual(["blob:mock-url-1"]);

    // Repeated cleanup should be idempotent and not revoke again
    controller.cleanup();
    expect(revokedUrls).toEqual(["blob:mock-url-1"]);
  });

  it("revokes both media URL and download URL exactly once in MediaSource mode", async () => {
    // Mock MediaSource and SourceBuffer
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

    const controller = new StreamPlaybackController();

    const stream = new ReadableStream<Uint8Array>({
      start(ctrl) {
        ctrl.enqueue(new Uint8Array([1, 2, 3]));
        ctrl.close();
      },
    });

    const mockResponse = {
      body: stream,
    } as unknown as Response;

    const callbacks = {
      onStreamReady: vi.fn(),
      onDownloadReady: vi.fn(),
      onError: vi.fn(),
      onFinish: vi.fn(),
    };

    const ac = new AbortController();
    await controller.startStream(mockResponse, ac.signal, callbacks);

    expect(callbacks.onStreamReady).toHaveBeenCalledWith("blob:mock-url-1");
    expect(callbacks.onDownloadReady).toHaveBeenCalledWith("blob:mock-url-2");
    expect(revokedUrls).toHaveLength(0);

    // Cleanup controller
    controller.cleanup();

    // Both distinct URLs revoked once
    expect(revokedUrls).toEqual(["blob:mock-url-1", "blob:mock-url-2"]);

    // Subsequent cleanup call does not double revoke
    controller.cleanup();
    expect(revokedUrls).toEqual(["blob:mock-url-1", "blob:mock-url-2"]);
  });

  it("isolates playback sessions: stale session A settling late does not cancel B, revoke B URLs, or fire stale callbacks", async () => {
    // Disable MediaSource for straightforward fallback stream testing
    // @ts-expect-error Mocking MediaSource
    delete window.MediaSource;

    const controller = new StreamPlaybackController();

    let resolveBlobA!: (blob: Blob) => void;
    const blobPromiseA = new Promise<Blob>((resolve) => {
      resolveBlobA = resolve;
    });

    const mockResponseA = {
      blob: vi.fn(() => blobPromiseA),
    } as unknown as Response;

    const callbacksA = {
      onStreamReady: vi.fn(),
      onDownloadReady: vi.fn(),
      onError: vi.fn(),
      onFinish: vi.fn(),
    };

    const acA = new AbortController();
    // Start session A (which remains pending on blobPromiseA)
    const runAPromise = controller.startStream(mockResponseA, acA.signal, callbacksA);

    // Now start session B immediately
    const mockBlobB = new Blob(["chunk B"], { type: "audio/mpeg" });
    const mockResponseB = {
      blob: vi.fn(async () => mockBlobB),
    } as unknown as Response;

    const callbacksB = {
      onStreamReady: vi.fn(),
      onDownloadReady: vi.fn(),
      onError: vi.fn(),
      onFinish: vi.fn(),
    };

    const acB = new AbortController();
    const runBPromise = controller.startStream(mockResponseB, acB.signal, callbacksB);

    await runBPromise;

    // Session B should be active and have delivered its result (first URL created was blob:mock-url-1)
    expect(callbacksB.onStreamReady).toHaveBeenCalledWith("blob:mock-url-1");
    expect(callbacksB.onDownloadReady).toHaveBeenCalledWith("blob:mock-url-1");
    expect(callbacksB.onFinish).toHaveBeenCalled();

    // Now session A resolves late!
    resolveBlobA(new Blob(["chunk A"], { type: "audio/mpeg" }));
    await runAPromise;

    // Session A callbacks must NEVER be called
    expect(callbacksA.onStreamReady).not.toHaveBeenCalled();
    expect(callbacksA.onDownloadReady).not.toHaveBeenCalled();
    expect(callbacksA.onFinish).not.toHaveBeenCalled();
    expect(callbacksA.onError).not.toHaveBeenCalled();

    // Session B URLs must NOT be revoked!
    expect(revokedUrls).not.toContain("blob:mock-url-1");

    // Session A was cancelled before creating any URL, so URL.createObjectURL was not called for A
    expect(URL.createObjectURL).toHaveBeenCalledTimes(1);

    // Finally cleanup controller (which cleans up B)
    controller.cleanup();
    expect(revokedUrls).toContain("blob:mock-url-1");
  });
});
