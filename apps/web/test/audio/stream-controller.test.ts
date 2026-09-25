import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { StreamPlaybackController } from "../../src/audio/stream-controller.js";

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

  it("Blob fallback genuine error: calls onError exactly once and does not call onFinish or ready callbacks", async () => {
    // MediaSource unavailable
    // @ts-expect-error Mocking MediaSource
    delete window.MediaSource;

    const controller = new StreamPlaybackController();
    const blobError = new Error("blob failed");
    const mockResponse = {
      blob: vi.fn().mockRejectedValue(blobError),
    } as unknown as Response;

    const callbacks = {
      onStreamReady: vi.fn(),
      onDownloadReady: vi.fn(),
      onError: vi.fn(),
      onFinish: vi.fn(),
    };

    const ac = new AbortController();
    await controller.startStream(mockResponse, ac.signal, callbacks);

    expect(callbacks.onError).toHaveBeenCalledTimes(1);
    expect(callbacks.onError).toHaveBeenCalledWith(blobError);
    expect(callbacks.onFinish).not.toHaveBeenCalled();
    expect(callbacks.onStreamReady).not.toHaveBeenCalled();
    expect(callbacks.onDownloadReady).not.toHaveBeenCalled();
  });

  it("MediaSource stream failure (reader error): calls onError exactly once and cleans up resources", async () => {
    class MockSourceBuffer extends EventTarget {
      updating = false;
      appendBuffer = vi.fn();
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

    const readError = new Error("reader stream failed");
    const failingStream = new ReadableStream<Uint8Array>({
      start(ctrl) {
        ctrl.error(readError);
      },
    });

    const mockResponse = {
      body: failingStream,
    } as unknown as Response;

    const callbacks = {
      onStreamReady: vi.fn(),
      onDownloadReady: vi.fn(),
      onError: vi.fn(),
      onFinish: vi.fn(),
    };

    const ac = new AbortController();
    await controller.startStream(mockResponse, ac.signal, callbacks);

    expect(callbacks.onError).toHaveBeenCalledTimes(1);
    expect(callbacks.onError).toHaveBeenCalledWith(readError);
    expect(callbacks.onFinish).not.toHaveBeenCalled();
    expect(revokedUrls).toContain("blob:mock-url-1");
  });

  it("MediaSource addSourceBuffer failure falls back cleanly to Blob playback", async () => {
    class MockMediaSource extends EventTarget {
      readyState = "open";
      addSourceBuffer = vi.fn(() => {
        throw new Error("Format not supported");
      });
      endOfStream = vi.fn();
      static isTypeSupported = vi.fn(() => true);
    }

    // @ts-expect-error Mocking MediaSource
    window.MediaSource = MockMediaSource;

    const controller = new StreamPlaybackController();
    const fallbackBlob = new Blob(["fallback-audio"], { type: "audio/mpeg" });
    const mockResponse = {
      blob: vi.fn().mockResolvedValue(fallbackBlob),
    } as unknown as Response;

    const callbacks = {
      onStreamReady: vi.fn(),
      onDownloadReady: vi.fn(),
      onError: vi.fn(),
      onFinish: vi.fn(),
    };

    const ac = new AbortController();
    await controller.startStream(mockResponse, ac.signal, callbacks);

    // Initial MediaSource URL (blob:mock-url-1) should have been revoked before/during fallback
    expect(revokedUrls).toContain("blob:mock-url-1");

    // Blob URL created is blob:mock-url-2
    expect(callbacks.onStreamReady).toHaveBeenCalledWith("blob:mock-url-2");
    expect(callbacks.onDownloadReady).toHaveBeenCalledWith("blob:mock-url-2");
    expect(callbacks.onFinish).toHaveBeenCalledTimes(1);
    expect(callbacks.onError).not.toHaveBeenCalled();

    // Cleanup revokes the fallback blob URL exactly once
    controller.cleanup();
    expect(revokedUrls).toEqual(["blob:mock-url-1", "blob:mock-url-2"]);
  });

  it("MediaSource addSourceBuffer failure followed by Blob fallback failure calls onError exactly once", async () => {
    class MockMediaSource extends EventTarget {
      readyState = "open";
      addSourceBuffer = vi.fn(() => {
        throw new Error("Format not supported");
      });
      endOfStream = vi.fn();
      static isTypeSupported = vi.fn(() => true);
    }

    // @ts-expect-error Mocking MediaSource
    window.MediaSource = MockMediaSource;

    const controller = new StreamPlaybackController();
    const fallbackError = new Error("blob fallback network failure");
    const mockResponse = {
      blob: vi.fn().mockRejectedValue(fallbackError),
    } as unknown as Response;

    const callbacks = {
      onStreamReady: vi.fn(),
      onDownloadReady: vi.fn(),
      onError: vi.fn(),
      onFinish: vi.fn(),
    };

    const ac = new AbortController();
    await controller.startStream(mockResponse, ac.signal, callbacks);

    expect(callbacks.onError).toHaveBeenCalledTimes(1);
    expect(callbacks.onError).toHaveBeenCalledWith(fallbackError);
    expect(callbacks.onFinish).not.toHaveBeenCalled();
    expect(revokedUrls).toContain("blob:mock-url-1");
  });

  it("MediaSource sourceopen error calls onError exactly once and revokes media URL", async () => {
    class MockMediaSource extends EventTarget {
      readyState = "closed";
      static isTypeSupported = vi.fn(() => true);
      addEventListener = vi.fn((type: string, listener: EventListenerOrEventListenerObject) => {
        super.addEventListener(type, listener);
        if (type === "error") {
          queueMicrotask(() => {
            this.dispatchEvent(new Event("error"));
          });
        }
      });
    }

    // @ts-expect-error Mocking MediaSource
    window.MediaSource = MockMediaSource;

    const controller = new StreamPlaybackController();
    const mockResponse = {} as unknown as Response;

    const callbacks = {
      onStreamReady: vi.fn(),
      onDownloadReady: vi.fn(),
      onError: vi.fn(),
      onFinish: vi.fn(),
    };

    const ac = new AbortController();
    await controller.startStream(mockResponse, ac.signal, callbacks);

    expect(callbacks.onError).toHaveBeenCalledTimes(1);
    expect(callbacks.onError).toHaveBeenCalledWith(
      expect.objectContaining({ message: "MediaSource error during open" }),
    );
    expect(callbacks.onFinish).not.toHaveBeenCalled();
    expect(revokedUrls).toContain("blob:mock-url-1");
  });

  it("MediaSource abort during sourceopen wait cancels cleanly without calling onError or onFinish", async () => {
    class MockMediaSource extends EventTarget {
      readyState = "closed";
      static isTypeSupported = vi.fn(() => true);
    }

    // @ts-expect-error Mocking MediaSource
    window.MediaSource = MockMediaSource;

    const controller = new StreamPlaybackController();
    const mockResponse = {} as unknown as Response;

    const callbacks = {
      onStreamReady: vi.fn(),
      onDownloadReady: vi.fn(),
      onError: vi.fn(),
      onFinish: vi.fn(),
    };

    const ac = new AbortController();
    const streamPromise = controller.startStream(mockResponse, ac.signal, callbacks);

    // Abort while waiting for sourceopen
    ac.abort();
    await streamPromise;

    expect(callbacks.onError).not.toHaveBeenCalled();
    expect(callbacks.onFinish).not.toHaveBeenCalled();
    expect(revokedUrls).toContain("blob:mock-url-1");
  });

  it("SourceBuffer append error calls onError exactly once and cleans up session", async () => {
    class MockSourceBuffer extends EventTarget {
      updating = false;
      appendBuffer = vi.fn(() => {
        queueMicrotask(() => {
          this.dispatchEvent(new Event("error"));
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

    expect(callbacks.onError).toHaveBeenCalledTimes(1);
    expect(callbacks.onError).toHaveBeenCalledWith(
      expect.objectContaining({ message: "SourceBuffer error during appendBuffer" }),
    );
    expect(callbacks.onFinish).not.toHaveBeenCalled();
    expect(revokedUrls).toContain("blob:mock-url-1");
  });

  it("stale session A error after session B starts does not call A callbacks or affect session B", async () => {
    class MockSourceBuffer extends EventTarget {
      updating = false;
      appendBuffer = vi.fn(() => {
        queueMicrotask(() => {
          this.dispatchEvent(new Event("updateend"));
        });
      });
      abort = vi.fn();
    }

    class MockMediaSource extends EventTarget {
      readyState = "open";
      addSourceBuffer = vi.fn(() => new MockSourceBuffer() as unknown as SourceBuffer);
      endOfStream = vi.fn();
      static isTypeSupported = vi.fn(() => true);
    }

    // @ts-expect-error Mocking MediaSource
    window.MediaSource = MockMediaSource;

    const controller = new StreamPlaybackController();

    let rejectStreamA!: (err: Error) => void;
    const streamA = new ReadableStream<Uint8Array>({
      start(ctrl) {
        rejectStreamA = (err: Error) => {
          ctrl.error(err);
        };
      },
    });

    const mockResponseA = { body: streamA } as unknown as Response;
    const callbacksA = {
      onStreamReady: vi.fn(),
      onDownloadReady: vi.fn(),
      onError: vi.fn(),
      onFinish: vi.fn(),
    };

    const acA = new AbortController();
    const runAPromise = controller.startStream(mockResponseA, acA.signal, callbacksA);

    // Session B starts immediately
    const streamB = new ReadableStream<Uint8Array>({
      start(ctrl) {
        ctrl.enqueue(new Uint8Array([10, 20]));
        ctrl.close();
      },
    });

    const mockResponseB = { body: streamB } as unknown as Response;
    const callbacksB = {
      onStreamReady: vi.fn(),
      onDownloadReady: vi.fn(),
      onError: vi.fn(),
      onFinish: vi.fn(),
    };

    const acB = new AbortController();
    const runBPromise = controller.startStream(mockResponseB, acB.signal, callbacksB);

    await runBPromise;

    expect(callbacksB.onStreamReady).toHaveBeenCalledWith("blob:mock-url-2");
    expect(callbacksB.onDownloadReady).toHaveBeenCalledWith("blob:mock-url-3");
    expect(callbacksB.onFinish).toHaveBeenCalledTimes(1);

    // Now session A's stream rejects late
    rejectStreamA(new Error("Stream A late error"));
    await runAPromise;

    // Callbacks A must never receive onError
    expect(callbacksA.onError).not.toHaveBeenCalled();
    expect(callbacksA.onFinish).not.toHaveBeenCalled();

    // Session B's URLs must not be revoked
    expect(revokedUrls).not.toContain("blob:mock-url-2");
    expect(revokedUrls).not.toContain("blob:mock-url-3");
  });

  describe("Streaming Telemetry & Byte Accounting", () => {
    it.each([32768, 1024])(
      "accumulates bytes with %i-byte chunks, throttles progress, and reports final bytes",
      async (chunkSize) => {
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
        const progressReports: number[] = [];

        // Chunks: 32 KiB, empty (0 bytes), 32 KiB, 10 KiB
        const chunk1 = new Uint8Array(chunkSize).fill(1);
        const chunkEmpty = new Uint8Array(0);
        const chunk2 = new Uint8Array(chunkSize).fill(2);
        const chunk3 = new Uint8Array(10 * 1024).fill(3);

        const stream = new ReadableStream<Uint8Array>({
          start(ctrl) {
            for (let bytes = 0; bytes < 32768; bytes += chunkSize) ctrl.enqueue(chunk1);
            ctrl.enqueue(chunkEmpty);
            for (let bytes = 0; bytes < 32768; bytes += chunkSize) ctrl.enqueue(chunk2);
            ctrl.enqueue(chunk3);
            ctrl.close();
          },
        });

        const mockResponse = { body: stream } as unknown as Response;
        const callbacks = {
          onStreamReady: vi.fn(),
          onDownloadReady: vi.fn(),
          onError: vi.fn(),
          onFinish: vi.fn(),
          onProgress: vi.fn((bytes: number) => {
            progressReports.push(bytes);
          }),
        };

        const ac = new AbortController();
        await controller.startStream(mockResponse, ac.signal, callbacks);

        expect(callbacks.onFinish).toHaveBeenCalledTimes(1);
        expect(progressReports.length).toBe(3);

        // Chunk 1 reported 32768
        expect(progressReports[0]).toBe(32768);
        // Chunk 2 reported 65536
        expect(progressReports[1]).toBe(65536);
        // Final chunk 3 (10 KiB) emitted at stream finish even below 32 KiB threshold: 75776
        expect(progressReports[progressReports.length - 1]).toBe(75776);

        // Monotonic non-decreasing
        for (let i = 1; i < progressReports.length; i++) {
          expect(progressReports[i]).toBeGreaterThanOrEqual(progressReports[i - 1]!);
        }
      },
    );

    it("emits final byte count when total stream size is below throttle threshold (< 32 KiB)", async () => {
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
      const progressReports: number[] = [];

      const smallChunk = new Uint8Array(4096).fill(1);
      const stream = new ReadableStream<Uint8Array>({
        start(ctrl) {
          ctrl.enqueue(smallChunk);
          ctrl.close();
        },
      });

      const mockResponse = { body: stream } as unknown as Response;
      const callbacks = {
        onStreamReady: vi.fn(),
        onDownloadReady: vi.fn(),
        onError: vi.fn(),
        onFinish: vi.fn(),
        onProgress: vi.fn((bytes: number) => {
          progressReports.push(bytes);
        }),
      };

      const ac = new AbortController();
      await controller.startStream(mockResponse, ac.signal, callbacks);

      expect(callbacks.onFinish).toHaveBeenCalledTimes(1);
      expect(progressReports).toEqual([4096]);
    });

    it("Blob fallback reports final blob.size via onProgress", async () => {
      // @ts-expect-error Disable MediaSource to force fallback
      delete window.MediaSource;

      const controller = new StreamPlaybackController();
      const mockBlob = new Blob(["test payload 12345678"], { type: "audio/mpeg" });
      const mockResponse = {
        blob: vi.fn(async () => mockBlob),
      } as unknown as Response;

      const progressReports: number[] = [];
      const callbacks = {
        onStreamReady: vi.fn(),
        onDownloadReady: vi.fn(),
        onError: vi.fn(),
        onFinish: vi.fn(),
        onProgress: vi.fn((bytes: number) => {
          progressReports.push(bytes);
        }),
      };

      const ac = new AbortController();
      await controller.startStream(mockResponse, ac.signal, callbacks);

      expect(callbacks.onFinish).toHaveBeenCalledTimes(1);
      expect(progressReports).toEqual([mockBlob.size]);
    });

    it("cancel prevents subsequent onProgress invocations", async () => {
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
      const progressReports: number[] = [];

      let pushMore: () => void;
      const stream = new ReadableStream<Uint8Array>({
        start(ctrl) {
          ctrl.enqueue(new Uint8Array(32 * 1024));
          pushMore = () => {
            try {
              ctrl.enqueue(new Uint8Array(32 * 1024));
              ctrl.close();
            } catch {
              // Ignore cancellation of underlying stream
            }
          };
        },
      });

      const mockResponse = { body: stream } as unknown as Response;
      const callbacks = {
        onStreamReady: vi.fn(),
        onDownloadReady: vi.fn(),
        onError: vi.fn(),
        onFinish: vi.fn(),
        onProgress: vi.fn((bytes: number) => {
          progressReports.push(bytes);
        }),
      };

      const ac = new AbortController();
      const promise = controller.startStream(mockResponse, ac.signal, callbacks);

      // Initial chunk reported
      await vi.waitFor(() => {
        expect(progressReports).toEqual([32768]);
      });

      // Cancel session
      controller.cancel();

      // Push more bytes after cancel
      pushMore!();
      await promise;

      // Must not receive further progress callbacks
      expect(progressReports).toEqual([32768]);
      expect(callbacks.onFinish).not.toHaveBeenCalled();
    });

    it("stale session cannot trigger progress on new session", async () => {
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

      let pushA: () => void;
      const streamA = new ReadableStream<Uint8Array>({
        start(ctrl) {
          ctrl.enqueue(new Uint8Array(32 * 1024));
          pushA = () => {
            try {
              ctrl.enqueue(new Uint8Array(32 * 1024));
              ctrl.close();
            } catch {
              // Ignore cancellation of underlying stream
            }
          };
        },
      });

      const callbacksA = {
        onStreamReady: vi.fn(),
        onDownloadReady: vi.fn(),
        onError: vi.fn(),
        onFinish: vi.fn(),
        onProgress: vi.fn(),
      };

      const acA = new AbortController();
      const promiseA = controller.startStream(
        { body: streamA } as Response,
        acA.signal,
        callbacksA,
      );
      await vi.waitFor(() => {
        expect(callbacksA.onProgress).toHaveBeenCalledWith(32768);
      });

      // Start Session B
      const streamB = new ReadableStream<Uint8Array>({
        start(ctrl) {
          ctrl.enqueue(new Uint8Array(5000));
          ctrl.close();
        },
      });

      const callbacksB = {
        onStreamReady: vi.fn(),
        onDownloadReady: vi.fn(),
        onError: vi.fn(),
        onFinish: vi.fn(),
        onProgress: vi.fn(),
      };

      const acB = new AbortController();
      const promiseB = controller.startStream(
        { body: streamB } as Response,
        acB.signal,
        callbacksB,
      );
      await promiseB;

      expect(callbacksB.onProgress).toHaveBeenCalledWith(5000);

      // Push more into stale stream A
      callbacksA.onProgress.mockClear();
      pushA!();
      await promiseA;

      // Stale session A must not emit progress
      expect(callbacksA.onProgress).not.toHaveBeenCalled();
    });
  });
});
