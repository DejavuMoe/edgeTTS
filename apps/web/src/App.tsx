import { useCallback, useEffect, useId, useMemo, useRef, useState } from "react";
import {
  MAX_NATIVE_INPUT_CODE_POINTS,
  countCodePoints,
  type NativeSpeechRequest,
  type VoiceDto,
} from "@edgetts/shared";
import { ApiHttpError, fetchHealth, fetchVoices, synthesizeSpeech } from "./api/client.js";
import { StreamPlaybackController } from "./audio/stream-controller.js";
import {
  loadWorkbenchPreferences,
  saveWorkbenchPreferences,
  resolveEffectiveVoiceId,
  type WorkbenchPreferencesV1,
} from "./preferences.js";
import {
  createCompletedResultMeta,
  formatResultMetadataDisplay,
  type CompletedResultMeta,
  type GenerationSnapshot,
} from "./result-metadata.js";
import {
  getLocaleOptions,
  formatVoiceGender,
  filterVoices,
  getGroupedVoices,
  isVoiceVisible,
} from "./voice-catalog.js";
import {
  loadFavoriteVoiceIds,
  saveFavoriteVoiceIds,
  toggleFavoriteVoiceId,
} from "./voice-favorites.js";
import { countLines } from "./text-stats.js";
import { readImportedTextFile } from "./text-import.js";
import {
  type GenerationTelemetryState,
  parseSynthesisPlanHeaders,
  formatGeneratingStatusText,
} from "./synthesis-telemetry.js";
import { Select, Checkbox, Slider, AudioPlayer } from "./ui/index.js";
import { I18nProvider, useI18n, LANGUAGE_OPTIONS, type MessageKey, type UiLocale } from "./i18n.js";
import "./App.css";

type ApiStatus = "loading" | "healthy" | "unavailable";

export const MIN_API_KEY_LENGTH = 16;

export function isValidApiKeyFormat(key: string): boolean {
  return key.length >= MIN_API_KEY_LENGTH && !/\s/.test(key);
}

export function App() {
  return (
    <I18nProvider>
      <Workbench />
    </I18nProvider>
  );
}

function Workbench() {
  const { locale, setLocale, t } = useI18n();
  const clearDialogRef = useRef<HTMLDialogElement>(null);
  // Synchronous preference hydration on initial render
  const [initialPreferences] = useState<WorkbenchPreferencesV1>(() => loadWorkbenchPreferences());
  const savedVoiceIdRef = useRef<string>(initialPreferences.voiceId);
  const isHydratedRef = useRef<boolean>(false);

  // Favorites state
  const [favoriteVoiceIds, setFavoriteVoiceIds] = useState<string[]>(() => loadFavoriteVoiceIds());

  const [apiStatus, setApiStatus] = useState<ApiStatus>("loading");
  const [voices, setVoices] = useState<readonly VoiceDto[]>([]);
  const [selectedVoiceId, setSelectedVoiceId] = useState<string>("");

  // Ephemeral filter states (not persisted across reloads)
  const [voiceSearch, setVoiceSearch] = useState<string>("");
  const [selectedLocale, setSelectedLocale] = useState<string>("all");
  const [favoriteOnly, setFavoriteOnly] = useState<boolean>(false);
  const [voiceError, setVoiceError] = useState<MessageKey | null>(null);

  // In-memory authentication state (never persisted to storage)
  const apiKeyRef = useRef<string | null>(null);
  const [authRequired, setAuthRequired] = useState<boolean>(false);
  const [authKeyInput, setAuthKeyInput] = useState<string>("");
  const [authError, setAuthError] = useState<MessageKey | null>(null);
  const [isUnlocking, setIsUnlocking] = useState<boolean>(false);

  // Form controls initialized from persisted preferences
  const [input, setInput] = useState<string>("");
  const [quality, setQuality] = useState<"standard" | "high">(initialPreferences.quality);
  const [speed, setSpeed] = useState<number>(initialPreferences.speed);
  const [pitchSemitones, setPitchSemitones] = useState<number>(initialPreferences.pitchSemitones);
  const [volume, setVolume] = useState<number>(initialPreferences.volume);

  // Generation & Playback state
  const [isGenerating, setIsGenerating] = useState<boolean>(false);
  const [generationError, setGenerationError] = useState<MessageKey | null>(null);
  const [audioSrc, setAudioSrc] = useState<string | null>(null);
  const [downloadUrl, setDownloadUrl] = useState<string | null>(null);
  const [completedResult, setCompletedResult] = useState<CompletedResultMeta | null>(null);
  const [telemetry, setTelemetry] = useState<GenerationTelemetryState | null>(null);

  // Local file import & editor state
  const [importError, setImportError] = useState<MessageKey | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const importGenerationIdRef = useRef<number>(0);
  const isMountedRef = useRef<boolean>(false);

  useEffect(() => {
    isMountedRef.current = true;
    return () => {
      isMountedRef.current = false;
      ++importGenerationIdRef.current;
    };
  }, []);

  const generationIdRef = useRef<number>(0);
  const abortControllerRef = useRef<AbortController | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const streamControllerRef = useRef<StreamPlaybackController | null>(null);

  if (!streamControllerRef.current) {
    streamControllerRef.current = new StreamPlaybackController();
  }

  // Form element IDs for accessible labels
  const textInputId = useId();
  const voiceSearchId = useId();
  const localeSelectId = useId();
  const favoriteOnlyCheckboxId = useId();
  const voiceSelectId = useId();
  const qualitySelectId = useId();
  const speedSliderId = useId();
  const pitchSliderId = useId();
  const volumeSliderId = useId();

  // Character count & line count calculation
  const codePointCount = useMemo(() => countCodePoints(input), [input]);
  const lineCount = useMemo(() => countLines(input), [input]);
  const isOverLimit = codePointCount > MAX_NATIVE_INPUT_CODE_POINTS;
  const isInputEmpty = input.trim().length === 0;

  // Favorites fast lookup
  const favoriteSet = useMemo(() => new Set(favoriteVoiceIds), [favoriteVoiceIds]);

  // Catalog partitions and locales
  const localeOptions = useMemo(() => getLocaleOptions(voices, locale), [voices, locale]);

  const totalFavoritesInCatalog = useMemo(
    () => voices.filter((v) => favoriteSet.has(v.id)).length,
    [voices, favoriteSet],
  );

  // Filter voices based on search query, locale partition, and favoriteOnly toggle
  const filteredVoices = useMemo(
    () =>
      filterVoices(voices, {
        search: voiceSearch,
        locale: selectedLocale,
        favoriteOnly,
        favoriteIds: favoriteSet,
        uiLocale: locale,
      }),
    [voices, voiceSearch, selectedLocale, favoriteOnly, favoriteSet, locale],
  );

  // Visibility of active selection in current filtered results
  const isCurrentVoiceVisible = useMemo(
    () => isVoiceVisible(filteredVoices, selectedVoiceId),
    [filteredVoices, selectedVoiceId],
  );

  // Hierarchical grouped catalog: Favorites first, then Locale groups
  const voiceGroups = useMemo(
    () => getGroupedVoices(filteredVoices, favoriteSet, locale),
    [filteredVoices, favoriteSet, locale],
  );

  const selectLocaleOptions = useMemo(
    () => localeOptions.map((opt) => ({ value: opt.locale, label: opt.label })),
    [localeOptions],
  );

  const selectVoiceGroups = useMemo(() => {
    return voiceGroups.map((group) => ({
      label: group.label,
      options: group.voices.map((v) => ({
        value: v.id,
        label: v.displayName,
        secondaryLabel: `${v.locale} · ${formatVoiceGender(v.gender, locale)}`,
      })),
    }));
  }, [voiceGroups, locale]);

  const selectVoicePlaceholderOptions = useMemo(() => {
    if (filteredVoices.length === 0) {
      return [{ value: "", label: t("没有匹配的声音"), disabled: true }];
    }
    if (!isCurrentVoiceVisible) {
      return [{ value: "", label: t("当前声音不在筛选结果中"), disabled: true }];
    }
    return undefined;
  }, [filteredVoices.length, isCurrentVoiceVisible, t]);

  const qualityOptions = useMemo(
    () => [
      { value: "standard", label: t("标准 (48 kbps MP3)") },
      { value: "high", label: t("高品质 (96 kbps MP3)") },
    ],
    [t],
  );

  // Active voice metadata
  const activeVoice = useMemo(
    () => voices.find((v) => v.id === selectedVoiceId),
    [voices, selectedVoiceId],
  );

  const isCurrentVoiceFavorite = Boolean(selectedVoiceId && favoriteSet.has(selectedVoiceId));

  const handleToggleFavorite = (): void => {
    if (!selectedVoiceId) return;
    const next = toggleFavoriteVoiceId(favoriteVoiceIds, selectedVoiceId);
    setFavoriteVoiceIds(next);
    saveFavoriteVoiceIds(next);
    const nextSet = new Set(next);
    const remainingInCatalog = voices.filter((v) => nextSet.has(v.id)).length;
    if (remainingInCatalog === 0) {
      setFavoriteOnly(false);
    }
  };

  // Parameters reset availability
  const isAllParametersDefault =
    quality === "standard" && speed === 1.0 && pitchSemitones === 0 && volume === 1.0;

  const handleResetAllParameters = (): void => {
    setQuality("standard");
    setSpeed(1.0);
    setPitchSemitones(0);
    setVolume(1.0);
  };

  // Local file import handler with async race and unmount guards
  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>): Promise<void> => {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) {
      return;
    }

    const currentGen = ++importGenerationIdRef.current;
    const result = await readImportedTextFile(file);

    if (!isMountedRef.current || importGenerationIdRef.current !== currentGen) {
      return;
    }

    if (result.success) {
      setInput(result.text);
      setImportError(null);
    } else {
      setImportError(result.error);
    }
  };

  const handleClearText = (): void => {
    if (!isGenerating && input.length > 0) clearDialogRef.current?.showModal();
  };

  const confirmClearText = (): void => {
    ++importGenerationIdRef.current;
    setInput("");
    setImportError(null);
    clearDialogRef.current?.close();
  };

  // Persist non-sensitive preferences only after hydration and when a valid voice is active
  useEffect(() => {
    if (!isHydratedRef.current) {
      if (selectedVoiceId) {
        isHydratedRef.current = true;
        saveWorkbenchPreferences({
          voiceId: selectedVoiceId,
          quality,
          speed,
          pitchSemitones,
          volume,
        });
      }
      return;
    }

    saveWorkbenchPreferences({
      voiceId: selectedVoiceId,
      quality,
      speed,
      pitchSemitones,
      volume,
    });
  }, [selectedVoiceId, quality, speed, pitchSemitones, volume]);

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
        setVoices(voiceList);
        setVoiceError(null);
        setAuthRequired(false);

        const targetId = resolveEffectiveVoiceId(voiceList, savedVoiceIdRef.current);
        if (targetId) {
          setSelectedVoiceId(targetId);
          savedVoiceIdRef.current = targetId;
        }
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
  }, []);

  // Cleanup stream controller and abort controller on unmount
  useEffect(() => {
    return () => {
      ++generationIdRef.current;
      streamControllerRef.current?.cleanup();
      if (abortControllerRef.current) {
        abortControllerRef.current.abort();
        abortControllerRef.current = null;
      }
    };
  }, []);

  const handleUnlock = async (e?: React.FormEvent): Promise<void> => {
    if (e) {
      e.preventDefault();
    }
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
      setVoices(voiceList);
      setVoiceError(null);

      const targetId = resolveEffectiveVoiceId(voiceList, savedVoiceIdRef.current);
      if (targetId) {
        setSelectedVoiceId(targetId);
        savedVoiceIdRef.current = targetId;
      }
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

  const handleGenerate = async (): Promise<void> => {
    if (isGenerating || isInputEmpty || isOverLimit || !selectedVoiceId || authRequired) {
      return;
    }

    // Cancel prior request if any
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
      abortControllerRef.current = null;
    }

    const currentGen = ++generationIdRef.current;
    const isCurrent = () => generationIdRef.current === currentGen;

    // Clean up previous playback stream, download URL, and completed metadata
    streamControllerRef.current?.cleanup();
    setAudioSrc(null);
    setDownloadUrl(null);
    setCompletedResult(null);
    setGenerationError(null);
    setIsGenerating(true);
    setTelemetry({
      phase: "requesting",
      segmentCount: null,
      maxSegmentCodePoints: null,
      bytesReceived: 0,
    });

    const controller = new AbortController();
    abortControllerRef.current = controller;

    const currentVoice = voices.find((v) => v.id === selectedVoiceId);
    const snapshot: GenerationSnapshot = {
      voiceId: selectedVoiceId,
      voiceDisplayName: currentVoice?.displayName ?? selectedVoiceId,
      quality,
      speed,
      pitchSemitones,
      volume,
    };

    const requestPayload: NativeSpeechRequest = {
      input,
      voice: selectedVoiceId,
      quality,
      speed,
      pitchSemitones,
      volume,
    };

    try {
      const response = await synthesizeSpeech(
        requestPayload,
        controller.signal,
        apiKeyRef.current ?? undefined,
      );

      if (!isCurrent()) {
        return;
      }

      if (!response.ok) {
        setIsGenerating(false);
        setTelemetry(null);
        if (response.status === 401) {
          apiKeyRef.current = null;
          setAuthRequired(true);
          setGenerationError("API Key 已失效或未提供，请重新验证");
          return;
        } else if (response.status === 429) {
          setGenerationError("Too many speech requests");
          return;
        } else if (response.status === 400) {
          setGenerationError("输入参数有误");
        } else if (response.status === 503) {
          setGenerationError("服务当前繁忙");
        } else if (response.status === 502) {
          setGenerationError("语音服务暂时不可用");
        } else {
          setGenerationError("语音服务暂时不可用");
        }
        return;
      }

      const plan = parseSynthesisPlanHeaders(response.headers);
      setTelemetry((prev) =>
        prev
          ? {
              ...prev,
              segmentCount: plan.segmentCount,
              maxSegmentCodePoints: plan.maxSegmentCodePoints,
            }
          : null,
      );

      let latestBytesReceived = 0;

      // Stream playback via MediaSource or Blob fallback
      await streamControllerRef.current?.startStream(response, controller.signal, {
        onStreamReady: (mediaUrl: string) => {
          if (!isCurrent()) return;
          setTelemetry((prev) => (prev ? { ...prev, phase: "streaming" } : null));
          setAudioSrc(mediaUrl);
        },
        onProgress: (bytesReceived: number) => {
          if (!isCurrent()) return;
          latestBytesReceived = bytesReceived;
          setTelemetry((prev) => (prev ? { ...prev, bytesReceived } : null));
        },
        onDownloadReady: (url: string) => {
          if (!isCurrent()) return;
          setDownloadUrl(url);
          setCompletedResult(
            createCompletedResultMeta({
              ...snapshot,
              segmentCount: plan.segmentCount,
              audioBytes: latestBytesReceived,
            }),
          );
        },
        onError: () => {
          if (!isCurrent()) return;
          setAudioSrc(null);
          setDownloadUrl(null);
          setCompletedResult(null);
          setTelemetry(null);
          setGenerationError("语音服务暂时不可用");
          setIsGenerating(false);
        },
        onFinish: () => {
          if (!isCurrent()) return;
          setIsGenerating(false);
          setTelemetry(null);
        },
      });
    } catch (err: unknown) {
      if (!isCurrent()) {
        return;
      }
      setTelemetry(null);
      if (err instanceof Error && err.name === "AbortError") {
        setGenerationError("已取消生成");
      } else {
        setGenerationError("网络请求失败");
      }
      setIsGenerating(false);
    } finally {
      if (abortControllerRef.current === controller) {
        abortControllerRef.current = null;
      }
    }
  };

  useEffect(() => {
    if (audioSrc) {
      audioRef.current?.play().catch(() => {
        // Autoplay policy prevented playback; user can use the visible controls.
      });
    }
  }, [audioSrc]);

  const handleCancel = useCallback((): void => {
    ++generationIdRef.current;
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
      abortControllerRef.current = null;
    }
    streamControllerRef.current?.cancel();
    setAudioSrc(null);
    setDownloadUrl(null);
    setCompletedResult(null);
    setTelemetry(null);
    setIsGenerating(false);
    setGenerationError("已取消生成");
  }, []);

  // Global Escape shortcut to cancel active synthesis
  useEffect(() => {
    if (!isGenerating) {
      return;
    }

    const handleKeyDown = (e: KeyboardEvent): void => {
      if (e.key === "Escape") {
        e.preventDefault();
        handleCancel();
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => {
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [isGenerating, handleCancel]);

  return (
    <div className="app-layout">
      <header className="app-header">
        <div className="header-brand">
          <h1 className="brand-title">EdgeTTS</h1>
          <span className="brand-badge">{t("Workbench")}</span>
        </div>
        <div className="header-tools">
          <div className="language-control">
            <Select
              options={LANGUAGE_OPTIONS}
              value={locale}
              onChange={(value) => setLocale(value as UiLocale)}
              aria-label={t("界面语言")}
            />
          </div>
          <div className="header-status">
            <span className="status-label">{t("API 状态")}</span>
            <span
              className="header-status-value"
              role="status"
              aria-live="polite"
              aria-atomic="true"
              aria-label={t("API 状态")}
            >
              {apiStatus === "loading" && (
                <span className="status-badge status-loading">{t("连接中...")}</span>
              )}
              {apiStatus === "healthy" && (
                <span className="status-badge status-healthy">{t("正常")}</span>
              )}
              {apiStatus === "unavailable" && (
                <span className="status-badge status-unavailable">{t("不可用")}</span>
              )}
            </span>
          </div>
        </div>
      </header>

      <dialog
        ref={clearDialogRef}
        className="confirm-dialog"
        aria-labelledby="clear-dialog-title"
        aria-describedby="clear-dialog-description"
      >
        <h2 id="clear-dialog-title" className="panel-title">
          {t("清空当前文本")}
        </h2>
        <p id="clear-dialog-description">{t("确定清空当前文本吗？此操作无法撤销。")}</p>
        <div className="dialog-actions">
          <button
            type="button"
            className="btn btn-secondary"
            onClick={() => clearDialogRef.current?.close()}
          >
            {t("取消")}
          </button>
          <button type="button" className="btn btn-primary" onClick={confirmClearText}>
            {t("确认清空")}
          </button>
        </div>
      </dialog>
      <main className="workbench-main">
        {/* Left Column: Text Editor */}
        <section className="panel editor-panel" aria-label={t("文本编辑区域")}>
          <div className="panel-header">
            <div className="editor-header-left">
              <label htmlFor={textInputId} className="panel-title">
                {t("文本内容")}
              </label>
              <div className="editor-actions">
                <input
                  ref={fileInputRef}
                  type="file"
                  accept=".txt,text/plain"
                  className="hidden-file-input"
                  tabIndex={-1}
                  aria-hidden="true"
                  onChange={handleFileChange}
                />
                <button
                  type="button"
                  className="btn-editor-action"
                  onClick={() => fileInputRef.current?.click()}
                  disabled={isGenerating}
                  aria-label={t("导入 TXT 文件")}
                >
                  {t("导入 TXT")}
                </button>
                <button
                  type="button"
                  className="btn-editor-action"
                  onClick={handleClearText}
                  disabled={isGenerating || input.length === 0}
                  aria-label={t("清空当前文本")}
                >
                  {t("清空")}
                </button>
              </div>
            </div>
            <span className={`char-counter ${isOverLimit ? "counter-error" : ""}`}>
              {t("{lines} 行 · {count} / {max} 字", {
                lines: lineCount.toLocaleString(locale),
                count: codePointCount.toLocaleString(locale),
                max: MAX_NATIVE_INPUT_CODE_POINTS.toLocaleString(locale),
              })}
            </span>
          </div>

          <textarea
            id={textInputId}
            className={`text-editor ${isOverLimit ? "editor-invalid" : ""}`}
            placeholder={t("在此输入需要合成为语音的文本内容...")}
            value={input}
            onChange={(e) => {
              ++importGenerationIdRef.current;
              setInput(e.target.value);
              if (importError) {
                setImportError(null);
              }
            }}
            onKeyDown={(e) => {
              if ((e.ctrlKey || e.metaKey) && e.key === "Enter") {
                e.preventDefault();
                void handleGenerate();
              }
            }}
            disabled={isGenerating}
            rows={14}
            aria-keyshortcuts="Control+Enter Meta+Enter"
          />

          <div className="editor-footer">
            <span className="shortcut-hint">{t("Ctrl/⌘ + Enter 合成 · Esc 取消")}</span>
          </div>

          <p className="control-hint">
            {t("合成时，文本会发送至微软在线语音服务；edgeTTS 不保存文本。")}
          </p>

          {importError && (
            <div className="input-warning" role="alert">
              {t(importError)}
            </div>
          )}

          {isOverLimit && (
            <div className="input-warning" role="alert">
              {t("文本长度超出上限 ({count} / {max} 字符)，请删减后再合成。", {
                count: codePointCount.toLocaleString(locale),
                max: MAX_NATIVE_INPUT_CODE_POINTS.toLocaleString(locale),
              })}
            </div>
          )}
        </section>

        {/* Right Column: Controls Panel */}
        <aside className="panel controls-panel" aria-label={t("语音参数配置")}>
          {/* Authentication Unlock Card */}
          {authRequired && (
            <div className="auth-card" role="region" aria-label={t("API 认证")}>
              <div className="auth-card-header">
                <span className="auth-card-title">{t("API 需要认证")}</span>
              </div>
              <form
                className="auth-card-form"
                onSubmit={(e) => {
                  e.preventDefault();
                  void handleUnlock();
                }}
              >
                <input
                  type="password"
                  className="auth-key-input"
                  aria-label="API Key"
                  placeholder={t("请输入 API Key")}
                  autoComplete="off"
                  spellCheck={false}
                  value={authKeyInput}
                  onChange={(e) => setAuthKeyInput(e.target.value)}
                  disabled={isUnlocking}
                />
                <button
                  type="submit"
                  className="btn-unlock"
                  disabled={isUnlocking || authKeyInput.length === 0}
                >
                  {isUnlocking ? t("验证中...") : t("解锁")}
                </button>
              </form>
              {authError && (
                <div className="auth-card-error" role="alert">
                  {t(authError)}
                </div>
              )}
            </div>
          )}

          {/* Voice Search & Locale Filter */}
          <div className="voice-filter-row">
            <div className="control-group search-group">
              <label htmlFor={voiceSearchId} className="control-label">
                {t("搜索声音")}
              </label>
              <input
                id={voiceSearchId}
                type="search"
                className="control-input"
                aria-describedby={`${voiceSearchId}-hint`}
                placeholder={t("搜索...")}
                value={voiceSearch}
                onChange={(e) => setVoiceSearch(e.target.value)}
                disabled={isGenerating || voices.length === 0}
              />
              <span id={`${voiceSearchId}-hint`} className="control-hint">
                {t("按名称、ID、语言或性别过滤")}
              </span>
            </div>

            <div className="control-group locale-group">
              <label htmlFor={localeSelectId} className="control-label">
                {t("地区 / Locale")}
              </label>
              <Select
                id={localeSelectId}
                value={selectedLocale}
                onChange={setSelectedLocale}
                options={selectLocaleOptions}
                disabled={isGenerating || voices.length === 0}
                aria-label={t("地区 / Locale")}
              />
            </div>
          </div>

          {/* Favorite Only Filter */}
          <div className="favorite-filter-row">
            <Checkbox
              id={favoriteOnlyCheckboxId}
              checked={favoriteOnly}
              onChange={setFavoriteOnly}
              disabled={isGenerating || totalFavoritesInCatalog === 0}
              label={t("只看收藏")}
            />
          </div>

          {/* Voice Selection */}
          <div className="control-group">
            <label htmlFor={voiceSelectId} className="control-label">
              {t("选择声音 ({count})", { count: filteredVoices.length })}
            </label>
            {voiceError ? (
              <div className="control-error" role="alert">
                {t(voiceError)}
              </div>
            ) : (
              <Select
                id={voiceSelectId}
                value={isCurrentVoiceVisible ? selectedVoiceId : ""}
                onChange={(newVoice) => {
                  if (newVoice) {
                    setSelectedVoiceId(newVoice);
                    savedVoiceIdRef.current = newVoice;
                  }
                }}
                options={selectVoicePlaceholderOptions}
                groups={filteredVoices.length > 0 ? selectVoiceGroups : undefined}
                disabled={isGenerating || filteredVoices.length === 0}
                aria-label={t("选择声音 ({count})", { count: filteredVoices.length })}
              />
            )}

            {/* Current Voice Details & Favorite Action */}
            {activeVoice && (
              <div className="current-voice-details" aria-label={t("当前声音详情")}>
                <div className="current-voice-meta">
                  <span className="current-voice-title">
                    {activeVoice.displayName} · {activeVoice.locale} ·{" "}
                    {formatVoiceGender(activeVoice.gender, locale)}
                  </span>
                  <span className="current-voice-id">{activeVoice.id}</span>
                </div>
                <button
                  type="button"
                  className={`btn-favorite ${isCurrentVoiceFavorite ? "is-favorite" : ""}`}
                  onClick={handleToggleFavorite}
                  disabled={isGenerating || !selectedVoiceId}
                  aria-pressed={isCurrentVoiceFavorite}
                  aria-label={isCurrentVoiceFavorite ? t("取消收藏当前声音") : t("收藏当前声音")}
                >
                  {isCurrentVoiceFavorite ? t("★ 已收藏") : t("☆ 收藏")}
                </button>
              </div>
            )}
          </div>

          {/* Quality */}
          <div className="control-group">
            <label htmlFor={qualitySelectId} className="control-label">
              {t("音质 (Quality)")}
            </label>
            <Select
              id={qualitySelectId}
              value={quality}
              onChange={(val) => setQuality(val as "standard" | "high")}
              options={qualityOptions}
              disabled={isGenerating}
              aria-label={t("音质 (Quality)")}
            />
          </div>

          {/* Speed */}
          <Slider
            id={speedSliderId}
            label={t("语速 (Speed)")}
            value={speed}
            formattedValue={`${speed.toFixed(2)}x`}
            min={0.5}
            max={2.0}
            step={0.05}
            onChange={setSpeed}
            onReset={() => setSpeed(1.0)}
            isDefault={speed === 1.0}
            resetAriaLabel={t("重置语速")}
            disabled={isGenerating}
          />

          {/* Pitch */}
          <Slider
            id={pitchSliderId}
            label={t("音调 (Pitch)")}
            value={pitchSemitones}
            formattedValue={t("{value} 半音", {
              value: pitchSemitones > 0 ? `+${pitchSemitones}` : pitchSemitones,
            })}
            min={-12}
            max={12}
            step={1}
            onChange={setPitchSemitones}
            onReset={() => setPitchSemitones(0)}
            isDefault={pitchSemitones === 0}
            resetAriaLabel={t("重置音调")}
            disabled={isGenerating}
          />

          {/* Volume */}
          <Slider
            id={volumeSliderId}
            label={t("音量 (Volume)")}
            value={volume}
            formattedValue={`${Math.round(volume * 100)}%`}
            min={0.0}
            max={1.0}
            step={0.05}
            onChange={setVolume}
            onReset={() => setVolume(1.0)}
            isDefault={volume === 1.0}
            resetAriaLabel={t("重置音量")}
            disabled={isGenerating}
          />

          {/* Reset All Synthesis Parameters */}
          <div className="reset-params-group">
            <button
              type="button"
              className="btn-reset-params"
              onClick={handleResetAllParameters}
              disabled={isGenerating || isAllParametersDefault}
              aria-label={t("恢复默认参数")}
            >
              {t("恢复默认参数")}
            </button>
          </div>

          {/* Action Buttons */}
          <div className="action-buttons">
            <button
              type="button"
              className="btn btn-primary"
              onClick={() => void handleGenerate()}
              disabled={
                isGenerating || isInputEmpty || isOverLimit || !selectedVoiceId || authRequired
              }
            >
              {isGenerating ? t("正在合成...") : t("合成语音")}
            </button>
            {isGenerating && (
              <button
                type="button"
                className="btn btn-secondary"
                onClick={handleCancel}
                aria-label={t("取消合成")}
                aria-keyshortcuts="Escape"
              >
                {t("取消")}
              </button>
            )}
          </div>
        </aside>

        {/* Bottom Section: Single Audio Player & Status */}
        <section className="panel result-panel" aria-label={t("合成结果播放")}>
          <div className="result-header">
            <h2 className="panel-title">{t("合成结果")}</h2>
            {isGenerating && telemetry && (
              <span
                className="generating-indicator"
                role="status"
                aria-live="polite"
                aria-label={t("合成状态")}
              >
                {formatGeneratingStatusText(telemetry, locale)}
              </span>
            )}
          </div>

          {generationError && (
            <div className="generation-error" role="alert">
              {t(generationError)}
            </div>
          )}

          {audioSrc && (
            <AudioPlayer
              ref={audioRef}
              src={audioSrc}
              downloadUrl={downloadUrl}
              downloadFilename={completedResult?.filename}
              aria-label={t("语音合成播放器")}
            />
          )}

          {audioSrc && completedResult && (
            <div className="result-metadata" aria-label={t("音频生成信息")}>
              <span>{formatResultMetadataDisplay(completedResult, locale)}</span>
            </div>
          )}

          {!audioSrc && !generationError && !isGenerating && (
            <p className="empty-result-text">{t("输入文本并点击“合成语音”后在此试听与下载。")}</p>
          )}
        </section>
      </main>
    </div>
  );
}
