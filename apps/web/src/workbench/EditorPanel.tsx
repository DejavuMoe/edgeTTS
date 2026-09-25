import { useId, useRef } from "react";
import { MAX_NATIVE_INPUT_CODE_POINTS } from "@edgetts/shared";
import { useI18n } from "../i18n.js";
import type { useTextDocument } from "./useTextDocument.js";

export interface EditorPanelProps {
  readonly textDocument: ReturnType<typeof useTextDocument>;
  readonly isGenerating: boolean;
  readonly onGenerate: () => void;
  readonly onRequestClear: () => void;
}

export function EditorPanel({
  textDocument,
  isGenerating,
  onGenerate,
  onRequestClear,
}: EditorPanelProps) {
  const { locale, t } = useI18n();
  const textInputId = useId();
  const noteId = useId();
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>): void => {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (file) {
      void textDocument.importFile(file);
    }
  };

  return (
    <section className="sheet" aria-label={t("文本编辑区域")}>
      <div className="sheet-header">
        <label htmlFor={textInputId} className="section-title">
          {t("文本内容")}
        </label>
        <div className="sheet-actions">
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
            className="btn-text"
            onClick={() => fileInputRef.current?.click()}
            disabled={isGenerating}
            aria-label={t("导入 TXT 文件")}
          >
            {t("导入 TXT")}
          </button>
          <button
            type="button"
            className="btn-text"
            onClick={onRequestClear}
            disabled={isGenerating || textDocument.text.length === 0}
            aria-label={t("清空当前文本")}
          >
            {t("清空")}
          </button>
        </div>
      </div>

      <textarea
        id={textInputId}
        className={`text-editor ${textDocument.isOverLimit ? "editor-invalid" : ""}`}
        placeholder={t("在此输入需要合成为语音的文本内容...")}
        value={textDocument.text}
        onChange={(e) => textDocument.edit(e.target.value)}
        onKeyDown={(e) => {
          if ((e.ctrlKey || e.metaKey) && e.key === "Enter") {
            e.preventDefault();
            onGenerate();
          }
        }}
        disabled={isGenerating}
        spellCheck={false}
        aria-describedby={noteId}
        aria-keyshortcuts="Control+Enter Meta+Enter"
      />

      {(textDocument.importError || textDocument.isOverLimit) && (
        <div className="sheet-alerts">
          {textDocument.importError && (
            <div className="inline-alert input-warning" role="alert">
              {t(textDocument.importError)}
            </div>
          )}
          {textDocument.isOverLimit && (
            <div className="inline-alert input-warning" role="alert">
              {t("文本长度超出上限 ({count} / {max} 字符)，请删减后再合成。", {
                count: textDocument.codePointCount.toLocaleString(locale),
                max: MAX_NATIVE_INPUT_CODE_POINTS.toLocaleString(locale),
              })}
            </div>
          )}
        </div>
      )}

      <div className="sheet-footer">
        <span id={noteId} className="sheet-note">
          {t("合成时，文本会发送至微软在线语音服务；edgeTTS 不保存文本。")}
        </span>
        <span className="shortcut-hint">{t("Ctrl/⌘ + Enter 合成 · Esc 取消")}</span>
        <span className={`char-counter ${textDocument.isOverLimit ? "counter-error" : ""}`}>
          {t("{lines} 行 · {count} / {max} 字", {
            lines: textDocument.lineCount.toLocaleString(locale),
            count: textDocument.codePointCount.toLocaleString(locale),
            max: MAX_NATIVE_INPUT_CODE_POINTS.toLocaleString(locale),
          })}
        </span>
      </div>
    </section>
  );
}
