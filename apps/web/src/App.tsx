import { useEffect, useId, useMemo, useRef, useState } from "react";
import {
  MAX_NATIVE_INPUT_CODE_POINTS,
  countCodePoints,
  type NativeSpeechRequest,
  type VoiceDto,
} from "@edgetts/shared";
import { fetchHealth, fetchVoices, synthesizeSpeech } from "./api/client.js";
import "./App.css";

type ApiStatus = "loading" | "healthy" | "unavailable";

export function App() {
  const [apiStatus, setApiStatus] = useState<ApiStatus>("loading");
  const [voices, setVoices] = useState<readonly VoiceDto[]>([]);
  const [selectedVoiceId, setSelectedVoiceId] = useState<string>("");
  const [voiceSearch, setVoiceSearch] = useState<string>("");
  const [voiceError, setVoiceError] = useState<string | null>(null);

  // Form controls
  const [input, setInput] = useState<string>("");
  const [quality, setQuality] = useState<"standard" | "high">("standard");
  const [speed, setSpeed] = useState<number>(1.0);
  const [pitchSemitones, setPitchSemitones] = useState<number>(0);
  const [volume, setVolume] = useState<number>(1.0);

  // Generation state
  const [isGenerating, setIsGenerating] = useState<boolean>(false);
  const [generationError, setGenerationError] = useState<string | null>(null);
  const [audioUrl, setAudioUrl] = useState<string | null>(null);

  const abortControllerRef = useRef<AbortController | null>(null);

  // Form element IDs for accessible labels
  const textInputId = useId();
  const voiceSearchId = useId();
  const voiceSelectId = useId();
  const qualitySelectId = useId();
  const speedSliderId = useId();
  const pitchSliderId = useId();
  const volumeSliderId = useId();

  // Character count calculation
  const codePointCount = useMemo(() => countCodePoints(input), [input]);
  const isOverLimit = codePointCount > MAX_NATIVE_INPUT_CODE_POINTS;
  const isInputEmpty = input.trim().length === 0;

  // Filter voices based on search query
  const filteredVoices = useMemo(() => {
    const q = voiceSearch.trim().toLowerCase();
    if (!q) {
      return voices;
    }
    return voices.filter(
      (v) =>
        v.displayName.toLowerCase().includes(q) ||
        v.id.toLowerCase().includes(q) ||
        v.locale.toLowerCase().includes(q),
    );
  }, [voices, voiceSearch]);

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

        // Auto-select default voice:
        // 1. zh-CN-XiaoxiaoNeural
        // 2. first zh-CN
        // 3. first available
        const xiaoxiao = voiceList.find((v) => v.id === "zh-CN-XiaoxiaoNeural");
        const anyZh = voiceList.find((v) => v.locale.toLowerCase().startsWith("zh-cn"));
        const firstAvailable = voiceList[0];

        const defaultVoice = xiaoxiao ?? anyZh ?? firstAvailable;
        if (defaultVoice) {
          setSelectedVoiceId(defaultVoice.id);
        }
      } catch {
        if (active) {
          setVoiceError("无法加载语音列表");
        }
      }
    }

    void init();

    return () => {
      active = false;
    };
  }, []);

  // Cleanup audio object URL on unmount
  useEffect(() => {
    return () => {
      if (audioUrl) {
        URL.revokeObjectURL(audioUrl);
      }
      if (abortControllerRef.current) {
        abortControllerRef.current.abort();
      }
    };
  }, [audioUrl]);

  const handleGenerate = async (): Promise<void> => {
    if (isGenerating || isInputEmpty || isOverLimit || !selectedVoiceId) {
      return;
    }

    // Cancel prior request if any
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
    }

    // Revoke previous audio URL
    if (audioUrl) {
      URL.revokeObjectURL(audioUrl);
      setAudioUrl(null);
    }

    setGenerationError(null);
    setIsGenerating(true);

    const controller = new AbortController();
    abortControllerRef.current = controller;

    const requestPayload: NativeSpeechRequest = {
      input,
      voice: selectedVoiceId,
      quality,
      speed,
      pitchSemitones,
      volume,
    };

    try {
      const response = await synthesizeSpeech(requestPayload, controller.signal);

      if (!response.ok) {
        if (response.status === 400) {
          setGenerationError("输入参数有误");
        } else if (response.status === 503) {
          setGenerationError("服务当前繁忙");
        } else if (response.status === 502) {
          setGenerationError("语音服务暂时不可用");
        } else {
          setGenerationError("语音服务暂时不可用");
        }
        setIsGenerating(false);
        return;
      }

      // Phase 10: Consume complete Blob and generate object URL
      const blob = await response.blob();
      const newAudioUrl = URL.createObjectURL(blob);
      setAudioUrl(newAudioUrl);
      setGenerationError(null);
    } catch (err: unknown) {
      if (err instanceof Error && err.name === "AbortError") {
        setGenerationError("已取消生成");
      } else {
        setGenerationError("网络请求失败");
      }
    } finally {
      setIsGenerating(false);
      abortControllerRef.current = null;
    }
  };

  const handleCancel = (): void => {
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
      abortControllerRef.current = null;
    }
    setIsGenerating(false);
  };

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
            <label htmlFor={textInputId} className="panel-title">
              文本内容
            </label>
            <span className={`char-counter ${isOverLimit ? "counter-error" : ""}`}>
              {codePointCount.toLocaleString()} / {MAX_NATIVE_INPUT_CODE_POINTS.toLocaleString()} 字
            </span>
          </div>

          <textarea
            id={textInputId}
            className={`text-editor ${isOverLimit ? "editor-invalid" : ""}`}
            placeholder="在此输入需要合成为语音的文本内容..."
            value={input}
            onChange={(e) => setInput(e.target.value)}
            disabled={isGenerating}
            rows={14}
          />

          {isOverLimit && (
            <div className="input-warning" role="alert">
              文本长度超出上限 ({codePointCount.toLocaleString()} /{" "}
              {MAX_NATIVE_INPUT_CODE_POINTS.toLocaleString()} 字符)，请删减后再合成。
            </div>
          )}
        </section>

        {/* Right Column: Controls Panel */}
        <aside className="panel controls-panel" aria-label="语音参数配置">
          {/* Voice Search & Selection */}
          <div className="control-group">
            <label htmlFor={voiceSearchId} className="control-label">
              搜索声音
            </label>
            <input
              id={voiceSearchId}
              type="search"
              className="control-input"
              placeholder="按名称或语言过滤 (如 zh-CN, Xiaoxiao)..."
              value={voiceSearch}
              onChange={(e) => setVoiceSearch(e.target.value)}
              disabled={isGenerating || voices.length === 0}
            />
          </div>

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
                value={selectedVoiceId}
                onChange={(e) => setSelectedVoiceId(e.target.value)}
                disabled={isGenerating || filteredVoices.length === 0}
              >
                {filteredVoices.map((v) => (
                  <option key={v.id} value={v.id}>
                    {v.displayName} ({v.locale} - {v.gender})
                  </option>
                ))}
              </select>
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

          {/* Action Buttons */}
          <div className="action-buttons">
            <button
              type="button"
              className="btn btn-primary"
              onClick={() => void handleGenerate()}
              disabled={isGenerating || isInputEmpty || isOverLimit || !selectedVoiceId}
            >
              {isGenerating ? "正在合成..." : "合成语音"}
            </button>
            {isGenerating && (
              <button
                type="button"
                className="btn btn-secondary"
                onClick={handleCancel}
                aria-label="取消合成"
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
            {isGenerating && <span className="generating-indicator">正在流式接收音频...</span>}
          </div>

          {generationError && (
            <div className="generation-error" role="alert">
              {generationError}
            </div>
          )}

          {audioUrl && (
            <div className="player-wrapper">
              <audio controls src={audioUrl} className="audio-player" aria-label="语音合成播放器">
                您的浏览器不支持音频播放。
              </audio>
              <a
                href={audioUrl}
                download="speech.mp3"
                className="btn btn-download"
                aria-label="下载合成音频"
              >
                下载 MP3
              </a>
            </div>
          )}

          {!audioUrl && !generationError && !isGenerating && (
            <p className="empty-result-text">输入文本并点击“合成语音”后在此试听与下载。</p>
          )}
        </section>
      </main>
    </div>
  );
}
