import { useCallback, useEffect, useReducer, useRef } from "react";
import type { NativeSpeechRequest } from "@edgetts/shared";
import { synthesizeSpeech } from "../api/client.js";
import { StreamPlaybackController } from "../audio/stream-controller.js";
import type { MessageKey } from "../i18n.js";
import { createCompletedResultMeta, type GenerationSnapshot } from "../result-metadata.js";
import { parseSynthesisPlanHeaders } from "../synthesis-telemetry.js";
import { INITIAL_SYNTHESIS_STATE, synthesisReducer } from "./synthesis-state.js";

export interface SynthesisOptions {
  readonly getApiKey: () => string | undefined;
  /** Called when the server rejects the API key during synthesis. */
  readonly onUnauthorized: () => void;
}

const HTTP_ERROR_MESSAGES: Readonly<Record<number, MessageKey>> = {
  400: "输入参数有误",
  429: "Too many speech requests",
  503: "服务当前繁忙",
};

/**
 * Runs one synthesis at a time. Every generation gets an id: callbacks from a superseded,
 * cancelled or unmounted generation are ignored.
 */
export function useSynthesis({ getApiKey, onUnauthorized }: SynthesisOptions) {
  const [state, dispatch] = useReducer(synthesisReducer, INITIAL_SYNTHESIS_STATE);
  const generationIdRef = useRef(0);
  const abortControllerRef = useRef<AbortController | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const streamControllerRef = useRef<StreamPlaybackController | null>(null);
  streamControllerRef.current ??= new StreamPlaybackController();

  // Cleanup stream controller and abort controller on unmount
  useEffect(() => {
    return () => {
      // Generation counter, not a DOM ref: unmount must invalidate the latest synthesis.
      // eslint-disable-next-line react-hooks/exhaustive-deps
      ++generationIdRef.current;
      streamControllerRef.current?.cleanup();
      if (abortControllerRef.current) {
        abortControllerRef.current.abort();
        abortControllerRef.current = null;
      }
    };
  }, []);

  const generate = async (
    request: NativeSpeechRequest,
    snapshot: GenerationSnapshot,
  ): Promise<void> => {
    // Cancel prior request if any
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
      abortControllerRef.current = null;
    }

    const currentGen = ++generationIdRef.current;
    const isCurrent = () => generationIdRef.current === currentGen;

    // Clean up previous playback stream, download URL, and completed metadata
    streamControllerRef.current?.cleanup();
    dispatch({ type: "started" });

    const controller = new AbortController();
    abortControllerRef.current = controller;

    try {
      const response = await synthesizeSpeech(request, controller.signal, getApiKey());
      if (!isCurrent()) {
        return;
      }

      if (!response.ok) {
        if (response.status === 401) {
          onUnauthorized();
          dispatch({ type: "rejected", error: "API Key 已失效或未提供，请重新验证" });
        } else {
          dispatch({
            type: "rejected",
            error: HTTP_ERROR_MESSAGES[response.status] ?? "语音服务暂时不可用",
          });
        }
        return;
      }

      const plan = parseSynthesisPlanHeaders(response.headers);
      dispatch({ type: "planned", plan });

      let latestBytesReceived = 0;

      // Stream playback via MediaSource or Blob fallback
      await streamControllerRef.current?.startStream(response, controller.signal, {
        onStreamReady: (mediaUrl: string) => {
          if (isCurrent()) dispatch({ type: "streamReady", mediaUrl });
        },
        onProgress: (bytesReceived: number) => {
          if (!isCurrent()) return;
          latestBytesReceived = bytesReceived;
          dispatch({ type: "progressed", bytesReceived });
        },
        onDownloadReady: (downloadUrl: string) => {
          if (!isCurrent()) return;
          dispatch({
            type: "downloadReady",
            downloadUrl,
            result: createCompletedResultMeta({
              ...snapshot,
              segmentCount: plan.segmentCount,
              audioBytes: latestBytesReceived,
            }),
          });
        },
        onError: () => {
          if (isCurrent()) dispatch({ type: "aborted", error: "语音服务暂时不可用" });
        },
        onFinish: () => {
          if (isCurrent()) dispatch({ type: "finished" });
        },
      });
    } catch (err: unknown) {
      if (!isCurrent()) {
        return;
      }
      const aborted = err instanceof Error && err.name === "AbortError";
      dispatch({ type: "rejected", error: aborted ? "已取消生成" : "网络请求失败" });
    } finally {
      if (abortControllerRef.current === controller) {
        abortControllerRef.current = null;
      }
    }
  };

  useEffect(() => {
    if (state.audioSrc) {
      audioRef.current?.play().catch(() => {
        // Autoplay policy prevented playback; user can use the visible controls.
      });
    }
  }, [state.audioSrc]);

  const cancel = useCallback((): void => {
    ++generationIdRef.current;
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
      abortControllerRef.current = null;
    }
    streamControllerRef.current?.cancel();
    dispatch({ type: "aborted", error: "已取消生成" });
  }, []);

  // Global Escape shortcut to cancel active synthesis
  useEffect(() => {
    if (!state.isGenerating) {
      return;
    }

    const handleKeyDown = (e: KeyboardEvent): void => {
      if (e.key === "Escape") {
        e.preventDefault();
        cancel();
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => {
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [state.isGenerating, cancel]);

  return { ...state, audioRef, generate, cancel };
}
