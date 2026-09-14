export function isMediaSourceAudioSupported(): boolean {
  return (
    typeof window !== "undefined" &&
    typeof window.MediaSource !== "undefined" &&
    typeof window.MediaSource.isTypeSupported === "function" &&
    window.MediaSource.isTypeSupported("audio/mpeg")
  );
}

export const PROGRESS_THROTTLE_BYTES = 32 * 1024;

export interface StreamPlaybackCallbacks {
  readonly onStreamReady: (mediaUrl: string) => void;
  readonly onDownloadReady: (downloadUrl: string) => void;
  readonly onError: (error: Error) => void;
  readonly onFinish: () => void;
  readonly onProgress?: (bytesReceived: number) => void;
}

interface PlaybackSession {
  readonly id: number;
  reader: ReadableStreamDefaultReader<Uint8Array> | null;
  mediaSource: MediaSource | null;
  sourceBuffer: SourceBuffer | null;
  mediaUrl: string | null;
  downloadUrl: string | null;
  closed: boolean;
  terminalEmitted: boolean;
}

function waitForUpdateEnd(buffer: SourceBuffer, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    const onEnd = () => {
      cleanup();
      resolve();
    };
    const onError = () => {
      cleanup();
      reject(new Error("SourceBuffer error during appendBuffer"));
    };
    const onAbort = () => {
      cleanup();
      resolve();
    };
    const cleanup = () => {
      buffer.removeEventListener("updateend", onEnd);
      buffer.removeEventListener("error", onError);
      signal?.removeEventListener("abort", onAbort);
    };
    buffer.addEventListener("updateend", onEnd);
    buffer.addEventListener("error", onError);
    if (signal?.aborted) {
      cleanup();
      resolve();
      return;
    }
    signal?.addEventListener("abort", onAbort, { once: true });
  });
}

export class StreamPlaybackController {
  private currentSession: PlaybackSession | null = null;
  private nextSessionId = 0;

  private isCurrentSession(session: PlaybackSession): boolean {
    return !session.closed && this.currentSession?.id === session.id;
  }

  private cleanupMediaSourceResources(session: PlaybackSession): void {
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

    if (session.mediaUrl) {
      try {
        URL.revokeObjectURL(session.mediaUrl);
      } catch {
        // ignore
      }
      session.mediaUrl = null;
    }
  }

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

  private finishSession(
    session: PlaybackSession,
    signal: AbortSignal,
    callbacks: StreamPlaybackCallbacks,
  ): void {
    const canFinish =
      !session.closed &&
      this.currentSession?.id === session.id &&
      !session.terminalEmitted &&
      !signal.aborted;

    if (canFinish) {
      session.terminalEmitted = true;
      callbacks.onFinish();
    }
  }

  private failSession(
    session: PlaybackSession,
    signal: AbortSignal,
    callbacks: StreamPlaybackCallbacks,
    error: unknown,
  ): void {
    const canEmit =
      !session.closed &&
      this.currentSession?.id === session.id &&
      !session.terminalEmitted &&
      !signal.aborted &&
      !(error instanceof Error && error.name === "AbortError");

    this.cleanupSession(session);

    if (canEmit) {
      session.terminalEmitted = true;
      callbacks.onError(error instanceof Error ? error : new Error(String(error)));
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

  private async playBlobFallback(
    session: PlaybackSession,
    response: Response,
    signal: AbortSignal,
    callbacks: StreamPlaybackCallbacks,
  ): Promise<void> {
    try {
      const blob = await response.blob();
      if (!this.isCurrentSession(session) || signal.aborted) {
        this.cleanupSession(session);
        return;
      }

      callbacks.onProgress?.(blob.size);

      const blobUrl = URL.createObjectURL(blob);
      session.mediaUrl = blobUrl;
      session.downloadUrl = blobUrl;

      if (this.isCurrentSession(session) && !signal.aborted) {
        callbacks.onStreamReady(blobUrl);
        callbacks.onDownloadReady(blobUrl);
        this.finishSession(session, signal, callbacks);
      } else {
        this.cleanupSession(session);
      }
    } catch (err: unknown) {
      this.failSession(session, signal, callbacks, err);
    }
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
      terminalEmitted: false,
    };
    this.currentSession = session;

    const onAbort = () => {
      this.cleanupSession(session);
    };

    if (signal.aborted) {
      this.cleanupSession(session);
      return;
    }
    signal.addEventListener("abort", onAbort, { once: true });

    try {
      // Fallback path: If MediaSource is unavailable or audio/mpeg is unsupported
      if (!isMediaSourceAudioSupported()) {
        await this.playBlobFallback(session, response, signal, callbacks);
        return;
      }

      // Primary path: MediaSource audio/mpeg streaming
      const mediaSource = new MediaSource();
      session.mediaSource = mediaSource;
      const mediaUrl = URL.createObjectURL(mediaSource);
      session.mediaUrl = mediaUrl;

      if (!this.isCurrentSession(session) || signal.aborted) {
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
        const onAbortOpen = () => {
          cleanup();
          resolve();
        };
        const cleanup = () => {
          mediaSource.removeEventListener("sourceopen", onOpen);
          mediaSource.removeEventListener("error", onError);
          signal.removeEventListener("abort", onAbortOpen);
        };
        mediaSource.addEventListener("sourceopen", onOpen);
        mediaSource.addEventListener("error", onError);
        if (signal.aborted) {
          cleanup();
          resolve();
          return;
        }
        signal.addEventListener("abort", onAbortOpen, { once: true });
      });

      if (!this.isCurrentSession(session) || signal.aborted) {
        this.cleanupSession(session);
        return;
      }

      let sourceBuffer: SourceBuffer;
      try {
        sourceBuffer = mediaSource.addSourceBuffer("audio/mpeg");
        session.sourceBuffer = sourceBuffer;
      } catch {
        // If adding sourceBuffer fails, cleanup MediaSource and fallback to blob
        this.cleanupMediaSourceResources(session);
        await this.playBlobFallback(session, response, signal, callbacks);
        return;
      }

      const chunks: Uint8Array[] = [];

      if (!response.body) {
        throw new Error("Response body is empty");
      }

      const reader = response.body.getReader();
      session.reader = reader;

      let totalBytes = 0;
      let lastReportedBytes = 0;

      while (true) {
        if (!this.isCurrentSession(session) || signal.aborted) {
          break;
        }

        const { done, value } = await reader.read();
        if (done || !this.isCurrentSession(session) || signal.aborted) {
          break;
        }

        if (value && value.byteLength > 0) {
          chunks.push(value);
          totalBytes += value.byteLength;

          if (totalBytes - lastReportedBytes >= PROGRESS_THROTTLE_BYTES) {
            callbacks.onProgress?.(totalBytes);
            lastReportedBytes = totalBytes;
          }

          if (sourceBuffer.updating) {
            await waitForUpdateEnd(sourceBuffer, signal);
          }

          if (
            mediaSource.readyState === "open" &&
            this.isCurrentSession(session) &&
            !signal.aborted
          ) {
            sourceBuffer.appendBuffer(value);
            await waitForUpdateEnd(sourceBuffer, signal);
          }
        }
      }

      if (!this.isCurrentSession(session) || signal.aborted) {
        this.cleanupSession(session);
        return;
      }

      if (totalBytes !== lastReportedBytes) {
        callbacks.onProgress?.(totalBytes);
        lastReportedBytes = totalBytes;
      }

      if (sourceBuffer.updating) {
        await waitForUpdateEnd(sourceBuffer, signal);
      }

      if (mediaSource.readyState === "open") {
        try {
          mediaSource.endOfStream();
        } catch {
          // ignore
        }
      }

      // Generate complete blob for download
      const finalBlob = new Blob(chunks as unknown as BlobPart[], { type: "audio/mpeg" });
      const downloadUrl = URL.createObjectURL(finalBlob);
      session.downloadUrl = downloadUrl;

      if (this.isCurrentSession(session) && !signal.aborted) {
        callbacks.onDownloadReady(downloadUrl);
        this.finishSession(session, signal, callbacks);
      } else {
        this.cleanupSession(session);
      }
    } catch (err: unknown) {
      this.failSession(session, signal, callbacks, err);
    } finally {
      signal.removeEventListener("abort", onAbort);
    }
  }
}
