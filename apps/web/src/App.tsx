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
import "./App.css";

type ApiStatus = "loading" | "healthy" | "unavailable";

export const MIN_API_KEY_LENGTH = 16;

export function isValidApiKeyFormat(key: string): boolean {
  return key.length >= MIN_API_KEY_LENGTH && !/\s/.test(key);
}

export function App() {
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
  const [voiceError, setVoiceError] = useState<string | null>(null);

  // In-memory authentication state (never persisted to storage)
  const apiKeyRef = useRef<string | null>(null);
  const [authRequired, setAuthRequired] = useState<boolean>(false);
  const [authKeyInput, setAuthKeyInput] = useState<string>("");
  const [authError, setAuthError] = useState<string | null>(null);
  const [isUnlocking, setIsUnlocking] = useState<boolean>(false);

  // Form controls initialized from persisted preferences
  const [input, setInput] = useState<string>("");
  const [quality, setQuality] = useState<"standard" | "high">(initialPreferences.quality);
  const [speed, setSpeed] = useState<number>(initialPreferences.speed);
  const [pitchSemitones, setPitchSemitones] = useState<number>(initialPreferences.pitchSemitones);
  const [volume, setVolume] = useState<number>(initialPreferences.volume);

  // Generation & Playback state
  const [isGenerating, setIsGenerating] = useState<boolean>(false);
  const [generationError, setGenerationError] = useState<string | null>(null);
  const [audioSrc, setAudioSrc] = useState<string | null>(null);
  const [downloadUrl, setDownloadUrl] = useState<string | null>(null);
  const [completedResult, setCompletedResult] = useState<CompletedResultMeta | null>(null);
  const [telemetry, setTelemetry] = useState<GenerationTelemetryState | null>(null);

  // Local file import & editor state
  const [importError, setImportError] = useState<string | null>(null);
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
  const localeOptions = useMemo(() => getLocaleOptions(voices), [voices]);

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
      }),
    [voices, voiceSearch, selectedLocale, favoriteOnly, favoriteSet],
  );

  // Visibility of active selection in current filtered results
  const isCurrentVoiceVisible = useMemo(
    () => isVoiceVisible(filteredVoices, selectedVoiceId),
    [filteredVoices, selectedVoiceId],
  );

  // Hierarchical grouped catalog: Favorites first, then Locale groups
  const voiceGroups = useMemo(
    () => getGroupedVoices(filteredVoices, favoriteSet),
    [filteredVoices, favoriteSet],
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

  // Safe text clearing with native confirmation
  const handleClearText = (): void => {
    if (isGenerating || input.length === 0) {
      return;
    }
    const confirmed = window.confirm("确定清空当前文本吗？此操作无法撤销。");
    if (confirmed) {
      setInput("");
      setImportError(null);
    }
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

  // Initial load: health & voices
  useEffect(() => {
    let active = true;

    async function init(): Promise<void> {
      try {
        const health = await fetchHealth();
        if (active) {
          setApiStatus(health.status === "ok" ? "healthy" : "unavailable");
        }
      } catch {
        if (active) {
          setApiStatus("unavailable");
        }
      }

      try {
        const voiceList = await fetchVoices();
        if (!active) return;
        setVoices(voiceList);
        setVoiceError(null);
        setAuthRequired(false);

        const targetId = resolveEffectiveVoiceId(voiceList, savedVoiceIdRef.current);
        if (targetId) {
          setSelectedVoiceId(targetId);
          savedVoiceIdRef.current = targetId;
        }
      } catch (err: unknown) {
        if (!active) return;
        if (err instanceof ApiHttpError && err.status === 401) {
          setAuthRequired(true);
          setVoiceError(null);
        } else {
          setVoiceError("无法加载语音列表");
        }
      }
    }

    void init();

    return () => {
      active = false;
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
          try {
            const data = (await response.json()) as { error?: { message?: string } };
            setGenerationError(data?.error?.message ?? "Too many speech requests");
          } catch {
            setGenerationError("Too many speech requests");
          }
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
          // Try playing; safely catch autoplay restrictions
          if (audioRef.current) {
            audioRef.current.play().catch(() => {
              // Autoplay policy prevented playback; user will click controls manually
            });
          }
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
          <span className="brand-badge">Workbench</span>
        </div>
        <div className="header-status">
          <span className="status-label">API 状态:</span>
          {apiStatus === "loading" && (
            <span className="status-badge status-loading">连接中...</span>
          )}
          {apiStatus === "healthy" && <span className="status-badge status-healthy">正常</span>}
          {apiStatus === "unavailable" && (
            <span className="status-badge status-unavailable">不可用</span>
          )}
        </div>
      </header>

      <main className="workbench-main">
        {/* Left Column: Text Editor */}
        <section className="panel editor-panel" aria-label="文本编辑区域">
          <div className="panel-header">
            <div className="editor-header-left">
              <label htmlFor={textInputId} className="panel-title">
                文本内容
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
                  aria-label="导入 TXT 文件"
                >
                  导入 TXT
                </button>
                <button
                  type="button"
                  className="btn-editor-action"
                  onClick={handleClearText}
                  disabled={isGenerating || input.length === 0}
                  aria-label="清空当前文本"
                >
                  清空
                </button>
              </div>
            </div>
            <span className={`char-counter ${isOverLimit ? "counter-error" : ""}`}>
              {lineCount} 行 · {codePointCount.toLocaleString()} /{" "}
              {MAX_NATIVE_INPUT_CODE_POINTS.toLocaleString()} 字
            </span>
          </div>

          <textarea
            id={textInputId}
            className={`text-editor ${isOverLimit ? "editor-invalid" : ""}`}
            placeholder="在此输入需要合成为语音的文本内容..."
            value={input}
            onChange={(e) => {
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
            <span className="shortcut-hint">Ctrl/⌘ + Enter 合成 · Esc 取消</span>
          </div>

          {importError && (
            <div className="input-warning" role="alert">
              {importError}
            </div>
          )}

          {isOverLimit && (
            <div className="input-warning" role="alert">
              文本长度超出上限 ({codePointCount.toLocaleString()} /{" "}
              {MAX_NATIVE_INPUT_CODE_POINTS.toLocaleString()} 字符)，请删减后再合成。
            </div>
          )}
        </section>

        {/* Right Column: Controls Panel */}
        <aside className="panel controls-panel" aria-label="语音参数配置">
          {/* Authentication Unlock Card */}
          {authRequired && (
            <div className="auth-card" role="region" aria-label="API 认证">
              <div className="auth-card-header">
                <span className="auth-card-title">API 需要认证</span>
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
                  placeholder="请输入 API Key"
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
                  {isUnlocking ? "验证中..." : "解锁"}
                </button>
              </form>
              {authError && (
                <div className="auth-card-error" role="alert">
                  {authError}
                </div>
              )}
            </div>
          )}

          {/* Voice Search & Locale Filter */}
          <div className="voice-filter-row">
            <div className="control-group search-group">
              <label htmlFor={voiceSearchId} className="control-label">
                搜索声音
              </label>
              <input
                id={voiceSearchId}
                type="search"
                className="control-input"
                placeholder="按名称、ID、语言或性别过滤..."
                value={voiceSearch}
                onChange={(e) => setVoiceSearch(e.target.value)}
                disabled={isGenerating || voices.length === 0}
              />
            </div>

            <div className="control-group locale-group">
              <label htmlFor={localeSelectId} className="control-label">
                地区 / Locale
              </label>
              <select
                id={localeSelectId}
                className="control-select"
                value={selectedLocale}
                onChange={(e) => setSelectedLocale(e.target.value)}
                disabled={isGenerating || voices.length === 0}
              >
                {localeOptions.map((opt) => (
                  <option key={opt.locale} value={opt.locale}>
                    {opt.label}
                  </option>
                ))}
              </select>
            </div>
          </div>

          {/* Favorite Only Filter */}
          <div className="favorite-filter-row">
            <label htmlFor={favoriteOnlyCheckboxId} className="favorite-checkbox-label">
              <input
                id={favoriteOnlyCheckboxId}
                type="checkbox"
                checked={favoriteOnly}
                onChange={(e) => setFavoriteOnly(e.target.checked)}
                disabled={isGenerating || totalFavoritesInCatalog === 0}
              />
              <span>只看收藏</span>
            </label>
          </div>

          {/* Voice Selection */}
          <div className="control-group">
            <label htmlFor={voiceSelectId} className="control-label">
              选择声音 ({filteredVoices.length})
            </label>
            {voiceError ? (
              <div className="control-error" role="alert">
                {voiceError}
              </div>
            ) : (
              <select
                id={voiceSelectId}
                className="control-select"
                value={isCurrentVoiceVisible ? selectedVoiceId : ""}
                onChange={(e) => {
                  const newVoice = e.target.value;
                  if (newVoice) {
                    setSelectedVoiceId(newVoice);
                    savedVoiceIdRef.current = newVoice;
                  }
                }}
                disabled={isGenerating || filteredVoices.length === 0}
              >
                {filteredVoices.length === 0 ? (
                  <option value="" disabled>
                    没有匹配的声音
                  </option>
                ) : !isCurrentVoiceVisible ? (
                  <option value="" disabled>
                    当前声音不在筛选结果中
                  </option>
                ) : null}
                {voiceGroups.map((group) => (
                  <optgroup key={group.label} label={group.label}>
                    {group.voices.map((v) => (
                      <option key={v.id} value={v.id}>
                        {v.displayName} ({v.locale} - {v.gender})
                      </option>
                    ))}
                  </optgroup>
                ))}
              </select>
            )}

            {/* Current Voice Details & Favorite Action */}
            {activeVoice && (
              <div className="current-voice-details" aria-label="当前声音详情">
                <div className="current-voice-meta">
                  <span className="current-voice-title">
                    {activeVoice.displayName} · {activeVoice.locale} · {activeVoice.gender}
                  </span>
                  <span className="current-voice-id">{activeVoice.id}</span>
                </div>
                <button
                  type="button"
                  className={`btn-favorite ${isCurrentVoiceFavorite ? "is-favorite" : ""}`}
                  onClick={handleToggleFavorite}
                  disabled={isGenerating || !selectedVoiceId}
                  aria-pressed={isCurrentVoiceFavorite}
                  aria-label={isCurrentVoiceFavorite ? "取消收藏当前声音" : "收藏当前声音"}
                >
                  {isCurrentVoiceFavorite ? "★ 已收藏" : "☆ 收藏"}
                </button>
              </div>
            )}
          </div>

          {/* Quality */}
          <div className="control-group">
            <label htmlFor={qualitySelectId} className="control-label">
              音质 (Quality)
            </label>
            <select
              id={qualitySelectId}
              className="control-select"
              value={quality}
              onChange={(e) => setQuality(e.target.value as "standard" | "high")}
              disabled={isGenerating}
            >
              <option value="standard">标准 (48 kbps MP3)</option>
              <option value="high">高品质 (96 kbps MP3)</option>
            </select>
          </div>

          {/* Speed */}
          <div className="control-group">
            <div className="control-header">
              <label htmlFor={speedSliderId} className="control-label">
                语速 (Speed)
              </label>
              <span className="control-value">{speed.toFixed(2)}x</span>
              <button
                type="button"
                className="btn-reset"
                onClick={() => setSpeed(1.0)}
                disabled={isGenerating || speed === 1.0}
                aria-label="重置语速"
              >
                重置
              </button>
            </div>
            <input
              id={speedSliderId}
              type="range"
              className="control-slider"
              min="0.5"
              max="2.0"
              step="0.05"
              value={speed}
              onChange={(e) => setSpeed(parseFloat(e.target.value))}
              disabled={isGenerating}
            />
          </div>

          {/* Pitch */}
          <div className="control-group">
            <div className="control-header">
              <label htmlFor={pitchSliderId} className="control-label">
                音调 (Pitch)
              </label>
              <span className="control-value">
                {pitchSemitones > 0 ? `+${pitchSemitones}` : pitchSemitones} 半音
              </span>
              <button
                type="button"
                className="btn-reset"
                onClick={() => setPitchSemitones(0)}
                disabled={isGenerating || pitchSemitones === 0}
                aria-label="重置音调"
              >
                重置
              </button>
            </div>
            <input
              id={pitchSliderId}
              type="range"
              className="control-slider"
              min="-12"
              max="12"
              step="1"
              value={pitchSemitones}
              onChange={(e) => setPitchSemitones(parseInt(e.target.value, 10))}
              disabled={isGenerating}
            />
          </div>

          {/* Volume */}
          <div className="control-group">
            <div className="control-header">
              <label htmlFor={volumeSliderId} className="control-label">
                音量 (Volume)
              </label>
              <span className="control-value">{Math.round(volume * 100)}%</span>
              <button
                type="button"
                className="btn-reset"
                onClick={() => setVolume(1.0)}
                disabled={isGenerating || volume === 1.0}
                aria-label="重置音量"
              >
                重置
              </button>
            </div>
            <input
              id={volumeSliderId}
              type="range"
              className="control-slider"
              min="0.0"
              max="1.0"
              step="0.05"
              value={volume}
              onChange={(e) => setVolume(parseFloat(e.target.value))}
              disabled={isGenerating}
            />
          </div>

          {/* Reset All Synthesis Parameters */}
          <div className="reset-params-group">
            <button
              type="button"
              className="btn-reset-params"
              onClick={handleResetAllParameters}
              disabled={isGenerating || isAllParametersDefault}
              aria-label="恢复默认参数"
            >
              恢复默认参数
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
              {isGenerating ? "正在合成..." : "合成语音"}
            </button>
            {isGenerating && (
              <button
                type="button"
                className="btn btn-secondary"
                onClick={handleCancel}
                aria-label="取消合成"
                aria-keyshortcuts="Escape"
              >
                取消
              </button>
            )}
          </div>
        </aside>

        {/* Bottom Section: Single Audio Player & Status */}
        <section className="panel result-panel" aria-label="合成结果播放">
          <div className="result-header">
            <h2 className="panel-title">合成结果</h2>
            {isGenerating && telemetry && (
              <span className="generating-indicator" role="status" aria-live="polite">
                {formatGeneratingStatusText(telemetry)}
              </span>
            )}
          </div>

          {generationError && (
            <div className="generation-error" role="alert">
              {generationError}
            </div>
          )}

          {audioSrc && (
            <div className="player-wrapper">
              <audio
                ref={audioRef}
                controls
                src={audioSrc}
                className="audio-player"
                aria-label="语音合成播放器"
              >
                您的浏览器不支持音频播放。
              </audio>
              {downloadUrl && completedResult && (
                <a
                  href={downloadUrl}
                  download={completedResult.filename}
                  className="btn btn-download"
                  aria-label="下载合成音频"
                >
                  下载 MP3
                </a>
              )}
            </div>
          )}

          {audioSrc && completedResult && (
            <div className="result-metadata" aria-label="音频生成信息">
              <span>{formatResultMetadataDisplay(completedResult)}</span>
            </div>
          )}

          {!audioSrc && !generationError && !isGenerating && (
            <p className="empty-result-text">输入文本并点击“合成语音”后在此试听与下载。</p>
          )}
        </section>
      </main>
    </div>
  );
}
