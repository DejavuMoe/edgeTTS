export function isMediaSourceAudioSupported(): boolean {
  return (
    typeof window !== "undefined" &&
    typeof window.MediaSource !== "undefined" &&
    typeof window.MediaSource.isTypeSupported === "function" &&
    window.MediaSource.isTypeSupported("audio/mpeg")
  );
}

export interface StreamPlaybackCallbacks {
  readonly onStreamReady: (mediaUrl: string) => void;
  readonly onDownloadReady: (downloadUrl: string) => void;
  readonly onError: (error: Error) => void;
  readonly onFinish: () => void;
}

function waitForUpdateEnd(buffer: SourceBuffer): Promise<void> {
  return new Promise((resolve, reject) => {
    const onEnd = () => {
      cleanup();
      resolve();
    };
    const onError = () => {
      cleanup();
      reject(new Error("SourceBuffer error during appendBuffer"));
    };
    const cleanup = () => {
      buffer.removeEventListener("updateend", onEnd);
      buffer.removeEventListener("error", onError);
    };
    buffer.addEventListener("updateend", onEnd);
    buffer.addEventListener("error", onError);
  });
}

export class StreamPlaybackController {
  private activeReader: ReadableStreamDefaultReader<Uint8Array> | null = null;
  private activeMediaSource: MediaSource | null = null;
  private activeMediaUrl: string | null = null;
  private activeDownloadUrl: string | null = null;

  cleanup(): void {
    if (this.activeReader) {
      this.activeReader.cancel().catch(() => {});
      this.activeReader = null;
    }
    if (this.activeMediaSource) {
      if (this.activeMediaSource.readyState === "open") {
        try {
          this.activeMediaSource.endOfStream();
        } catch {
          // ignore cleanup error
        }
      }
      this.activeMediaSource = null;
    }
    if (this.activeMediaUrl) {
      URL.revokeObjectURL(this.activeMediaUrl);
      this.activeMediaUrl = null;
    }
    if (this.activeDownloadUrl) {
      if (this.activeDownloadUrl !== this.activeMediaUrl) {
        URL.revokeObjectURL(this.activeDownloadUrl);
      }
      this.activeDownloadUrl = null;
    }
  }

  cancel(): void {
    this.cleanup();
  }

  async startStream(
    response: Response,
    signal: AbortSignal,
    callbacks: StreamPlaybackCallbacks,
  ): Promise<void> {
    this.cleanup();

    // Fallback path: If MediaSource is unavailable or audio/mpeg is unsupported
    if (!isMediaSourceAudioSupported()) {
      try {
        const blob = await response.blob();
        if (signal.aborted) return;
        const blobUrl = URL.createObjectURL(blob);
        this.activeMediaUrl = blobUrl;
        this.activeDownloadUrl = blobUrl;
        callbacks.onStreamReady(blobUrl);
        callbacks.onDownloadReady(blobUrl);
        callbacks.onFinish();
      } catch (err: unknown) {
        if (signal.aborted || (err instanceof Error && err.name === "AbortError")) {
          return;
        }
        callbacks.onError(err instanceof Error ? err : new Error(String(err)));
      }
      return;
    }

    // Primary path: MediaSource audio/mpeg streaming
    try {
      const mediaSource = new MediaSource();
      this.activeMediaSource = mediaSource;
      const mediaUrl = URL.createObjectURL(mediaSource);
      this.activeMediaUrl = mediaUrl;

      // Notify UI of stream player availability
      callbacks.onStreamReady(mediaUrl);

      // Wait for sourceopen
      await new Promise<void>((resolve, reject) => {
        if (mediaSource.readyState === "open") {
          resolve();
          return;
        }
        const onOpen = () => {
          cleanup();
          resolve();
        };
        const onError = () => {
          cleanup();
          reject(new Error("MediaSource error during open"));
        };
        const cleanup = () => {
          mediaSource.removeEventListener("sourceopen", onOpen);
          mediaSource.removeEventListener("error", onError);
        };
        mediaSource.addEventListener("sourceopen", onOpen);
        mediaSource.addEventListener("error", onError);
      });

      if (signal.aborted) {
        this.cleanup();
        return;
      }

      let sourceBuffer: SourceBuffer;
      try {
        sourceBuffer = mediaSource.addSourceBuffer("audio/mpeg");
      } catch {
        // If adding sourceBuffer fails unexpectedly, fallback to consuming blob
        this.cleanup();
        const blob = await response.blob();
        if (signal.aborted) return;
        const blobUrl = URL.createObjectURL(blob);
        this.activeMediaUrl = blobUrl;
        this.activeDownloadUrl = blobUrl;
        callbacks.onStreamReady(blobUrl);
        callbacks.onDownloadReady(blobUrl);
        callbacks.onFinish();
        return;
      }

      const chunks: Uint8Array[] = [];

      if (!response.body) {
        throw new Error("Response body is empty");
      }

      const reader = response.body.getReader();
      this.activeReader = reader;

      while (true) {
        if (signal.aborted) {
          break;
        }

        const { done, value } = await reader.read();
        if (done) {
          break;
        }

        if (value && value.byteLength > 0) {
          chunks.push(value);

          if (sourceBuffer.updating) {
            await waitForUpdateEnd(sourceBuffer);
          }

          if (mediaSource.readyState === "open" && !signal.aborted) {
            sourceBuffer.appendBuffer(value);
            await waitForUpdateEnd(sourceBuffer);
          }
        }
      }

      if (signal.aborted) {
        this.cleanup();
        return;
      }

      if (sourceBuffer.updating) {
        await waitForUpdateEnd(sourceBuffer);
      }

      if (mediaSource.readyState === "open") {
        mediaSource.endOfStream();
      }

      // Generate complete blob for download
      const finalBlob = new Blob(chunks as unknown as BlobPart[], { type: "audio/mpeg" });
      const downloadUrl = URL.createObjectURL(finalBlob);
      this.activeDownloadUrl = downloadUrl;
      callbacks.onDownloadReady(downloadUrl);
      callbacks.onFinish();
    } catch (err: unknown) {
      this.cleanup();
      if (signal.aborted || (err instanceof Error && err.name === "AbortError")) {
        return;
      }
      callbacks.onError(err instanceof Error ? err : new Error(String(err)));
    }
  }
}
