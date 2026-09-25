import { useCallback, useEffect, useRef, useState } from "react";
import type { VoiceDto } from "@edgetts/shared";
import { ApiHttpError, fetchHealth, fetchVoices } from "../api/client.js";
import type { MessageKey } from "../i18n.js";
import { resolveEffectiveVoiceId } from "../lib/preferences.js";

export type ApiStatus = "loading" | "healthy" | "unavailable";

export const MIN_API_KEY_LENGTH = 16;

export function isValidApiKeyFormat(key: string): boolean {
  return key.length >= MIN_API_KEY_LENGTH && !/\s/.test(key);
}

/**
 * Server health, the voice catalog, the selected voice and API key authentication.
 * The API key lives only in a ref: it is never rendered, persisted or placed in state.
 */
export function useWorkbenchConnection(preferredVoiceId: string) {
  const savedVoiceIdRef = useRef<string>(preferredVoiceId);
  const apiKeyRef = useRef<string | null>(null);

  const [apiStatus, setApiStatus] = useState<ApiStatus>("loading");
  const [voices, setVoices] = useState<readonly VoiceDto[]>([]);
  const [selectedVoiceId, setSelectedVoiceId] = useState<string>("");
  const [voiceError, setVoiceError] = useState<MessageKey | null>(null);

  const [authRequired, setAuthRequired] = useState<boolean>(false);
  const [authKeyInput, setAuthKeyInput] = useState<string>("");
  const [authError, setAuthError] = useState<MessageKey | null>(null);
  const [isUnlocking, setIsUnlocking] = useState<boolean>(false);

  // Stable: uses only state setters and a ref, so the mount effect below runs once.
  const applyVoices = useCallback((voiceList: readonly VoiceDto[]): void => {
    setVoices(voiceList);
    setVoiceError(null);
    const targetId = resolveEffectiveVoiceId(voiceList, savedVoiceIdRef.current);
    if (targetId) {
      setSelectedVoiceId(targetId);
      savedVoiceIdRef.current = targetId;
    }
  }, []);

  // Initial load: health and voices are independent so a slow health probe cannot block unlocking.
  useEffect(() => {
    let active = true;
    const controller = new AbortController();

    void fetchHealth(controller.signal)
      .then((health) => {
        if (active) setApiStatus(health.status === "ok" ? "healthy" : "unavailable");
      })
      .catch(() => {
        if (active) setApiStatus("unavailable");
      });

    void fetchVoices(undefined, controller.signal)
      .then((voiceList) => {
        if (!active) return;
        setAuthRequired(false);
        applyVoices(voiceList);
      })
      .catch((err: unknown) => {
        if (!active) return;
        if (err instanceof ApiHttpError && err.status === 401) {
          setAuthRequired(true);
          setVoiceError(null);
        } else {
          setVoiceError("无法加载语音列表");
        }
      });

    return () => {
      active = false;
      controller.abort();
    };
  }, [applyVoices]);

  const unlock = async (): Promise<void> => {
    if (!authKeyInput || isUnlocking) {
      return;
    }

    if (!isValidApiKeyFormat(authKeyInput)) {
      setAuthError("API Key 格式无效");
      return;
    }

    setIsUnlocking(true);
    setAuthError(null);

    try {
      const voiceList = await fetchVoices(authKeyInput);
      apiKeyRef.current = authKeyInput;
      setAuthKeyInput("");
      setAuthRequired(false);
      setAuthError(null);
      applyVoices(voiceList);
    } catch (err: unknown) {
      apiKeyRef.current = null;
      if (err instanceof ApiHttpError && err.status === 401) {
        setAuthError("API Key 无效");
      } else {
        setAuthError("网络请求失败");
      }
    } finally {
      setIsUnlocking(false);
    }
  };

  const selectVoice = (voiceId: string): void => {
    setSelectedVoiceId(voiceId);
    savedVoiceIdRef.current = voiceId;
  };

  /** Forgets the key after the server rejected it and asks the user to unlock again. */
  const requireReauthentication = (): void => {
    apiKeyRef.current = null;
    setAuthRequired(true);
  };

  return {
    apiStatus,
    voices,
    voiceError,
    selectedVoiceId,
    selectVoice,
    getApiKey: () => apiKeyRef.current ?? undefined,
    requireReauthentication,
    auth: {
      required: authRequired,
      keyInput: authKeyInput,
      setKeyInput: setAuthKeyInput,
      error: authError,
      isUnlocking,
      unlock,
    },
  };
}
