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

interface PlaybackSession {
  readonly id: number;
  reader: ReadableStreamDefaultReader<Uint8Array> | null;
  mediaSource: MediaSource | null;
  sourceBuffer: SourceBuffer | null;
  mediaUrl: string | null;
  downloadUrl: string | null;
  closed: boolean;
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
  private currentSession: PlaybackSession | null = null;
  private nextSessionId = 0;

  private cleanupSession(session: PlaybackSession): void {
    if (session.closed) {
      return;
    }
    session.closed = true;

    if (this.currentSession?.id === session.id) {
      this.currentSession = null;
    }

    if (session.reader) {
      try {
        session.reader.cancel().catch(() => {});
      } catch {
        // ignore
      }
      session.reader = null;
    }

    if (session.sourceBuffer) {
      try {
        if (session.sourceBuffer.updating) {
          session.sourceBuffer.abort();
        }
      } catch {
        // ignore
      }
      session.sourceBuffer = null;
    }

    if (session.mediaSource) {
      try {
        if (session.mediaSource.readyState === "open") {
          session.mediaSource.endOfStream();
        }
      } catch {
        // ignore
      }
      session.mediaSource = null;
    }

    const urlsToRevoke = new Set<string>();
    if (session.mediaUrl) {
      urlsToRevoke.add(session.mediaUrl);
      session.mediaUrl = null;
    }
    if (session.downloadUrl) {
      urlsToRevoke.add(session.downloadUrl);
      session.downloadUrl = null;
    }

    for (const url of urlsToRevoke) {
      try {
        URL.revokeObjectURL(url);
      } catch {
        // ignore
      }
    }
  }

  cleanup(): void {
    if (this.currentSession) {
      this.cleanupSession(this.currentSession);
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

    const session: PlaybackSession = {
      id: ++this.nextSessionId,
      reader: null,
      mediaSource: null,
      sourceBuffer: null,
      mediaUrl: null,
      downloadUrl: null,
      closed: false,
    };
    this.currentSession = session;

    const isCurrent = () => !session.closed && this.currentSession?.id === session.id;

    const onAbort = () => {
      this.cleanupSession(session);
    };

    if (signal.aborted) {
      this.cleanupSession(session);
      return;
    }
    signal.addEventListener("abort", onAbort, { once: true });

    // Fallback path: If MediaSource is unavailable or audio/mpeg is unsupported
    if (!isMediaSourceAudioSupported()) {
      try {
        const blob = await response.blob();
        if (!isCurrent() || signal.aborted) {
          this.cleanupSession(session);
          return;
        }

        const blobUrl = URL.createObjectURL(blob);
        session.mediaUrl = blobUrl;
        session.downloadUrl = blobUrl;

        if (isCurrent()) {
          callbacks.onStreamReady(blobUrl);
          callbacks.onDownloadReady(blobUrl);
          callbacks.onFinish();
        } else {
          this.cleanupSession(session);
        }
      } catch (err: unknown) {
        this.cleanupSession(session);
        if (!isCurrent() || signal.aborted || (err instanceof Error && err.name === "AbortError")) {
          return;
        }
        callbacks.onError(err instanceof Error ? err : new Error(String(err)));
      } finally {
        signal.removeEventListener("abort", onAbort);
      }
      return;
    }

    // Primary path: MediaSource audio/mpeg streaming
    try {
      const mediaSource = new MediaSource();
      session.mediaSource = mediaSource;
      const mediaUrl = URL.createObjectURL(mediaSource);
      session.mediaUrl = mediaUrl;

      if (!isCurrent()) {
        this.cleanupSession(session);
        return;
      }

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

      if (!isCurrent() || signal.aborted) {
        this.cleanupSession(session);
        return;
      }

      let sourceBuffer: SourceBuffer;
      try {
        sourceBuffer = mediaSource.addSourceBuffer("audio/mpeg");
        session.sourceBuffer = sourceBuffer;
      } catch {
        // If adding sourceBuffer fails unexpectedly, fallback to consuming blob
        this.cleanupSession(session);
        const blob = await response.blob();
        if (!isCurrent() || signal.aborted) {
          return;
        }
        const blobUrl = URL.createObjectURL(blob);
        session.mediaUrl = blobUrl;
        session.downloadUrl = blobUrl;
        if (isCurrent()) {
          callbacks.onStreamReady(blobUrl);
          callbacks.onDownloadReady(blobUrl);
          callbacks.onFinish();
        }
        return;
      }

      const chunks: Uint8Array[] = [];

      if (!response.body) {
        throw new Error("Response body is empty");
      }

      const reader = response.body.getReader();
      session.reader = reader;

      while (true) {
        if (!isCurrent() || signal.aborted) {
          break;
        }

        const { done, value } = await reader.read();
        if (done || !isCurrent()) {
          break;
        }

        if (value && value.byteLength > 0) {
          chunks.push(value);

          if (sourceBuffer.updating) {
            await waitForUpdateEnd(sourceBuffer);
          }

          if (mediaSource.readyState === "open" && isCurrent() && !signal.aborted) {
            sourceBuffer.appendBuffer(value);
            await waitForUpdateEnd(sourceBuffer);
          }
        }
      }

      if (!isCurrent() || signal.aborted) {
        this.cleanupSession(session);
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
      session.downloadUrl = downloadUrl;

      if (isCurrent()) {
        callbacks.onDownloadReady(downloadUrl);
        callbacks.onFinish();
      } else {
        this.cleanupSession(session);
      }
    } catch (err: unknown) {
      this.cleanupSession(session);
      if (!isCurrent() || signal.aborted || (err instanceof Error && err.name === "AbortError")) {
        return;
      }
      callbacks.onError(err instanceof Error ? err : new Error(String(err)));
    } finally {
      signal.removeEventListener("abort", onAbort);
    }
  }
}
