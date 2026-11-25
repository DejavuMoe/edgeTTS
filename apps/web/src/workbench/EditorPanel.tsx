import { useId, useRef, useState, type DragEvent, type ReactNode } from "react";
import { MAX_NATIVE_INPUT_CODE_POINTS } from "@edgetts/shared/limits";
import { useI18n } from "../i18n.js";
import type { useTextDocument } from "./useTextDocument.js";

export interface EditorPanelProps {
  readonly textDocument: ReturnType<typeof useTextDocument>;
  readonly isGenerating: boolean;
  readonly onRequestClear: () => void;
  /** The submit controls, placed at the end of the text like a send button. */
  readonly actions: ReactNode;
}

export function EditorPanel({
  textDocument,
  isGenerating,
  onRequestClear,
  actions,
}: EditorPanelProps) {
  const { locale, t } = useI18n();
  const textInputId = useId();
  const noteId = useId();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const [isDropTarget, setIsDropTarget] = useState(false);

  // Only file drags are ours: dragged text keeps the textarea's own drop behaviour.
  const carriesFiles = (e: DragEvent): boolean =>
    Array.from(e.dataTransfer.types).includes("Files");

  const handleDragOver = (e: DragEvent<HTMLElement>): void => {
    if (!carriesFiles(e)) return;
    // Always claim the drop, so a file dropped mid-synthesis never replaces the page.
    e.preventDefault();
    e.dataTransfer.dropEffect = isGenerating ? "none" : "copy";
    setIsDropTarget(!isGenerating);
  };

  const handleDragLeave = (e: DragEvent<HTMLElement>): void => {
    if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setIsDropTarget(false);
  };

  const handleDrop = (e: DragEvent<HTMLElement>): void => {
    if (!carriesFiles(e)) return;
    e.preventDefault();
    setIsDropTarget(false);
    const file = e.dataTransfer.files[0];
    if (file && !isGenerating) {
      void textDocument.importFile(file);
    }
  };

  const handleUndoImport = (): void => {
    textDocument.undoImport();
    // The Undo button goes away with the notice; keep focus on the restored text.
    textareaRef.current?.focus();
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>): void => {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (file) {
      void textDocument.importFile(file);
    }
  };

  return (
    <section
      className={`sheet ${isDropTarget ? "is-drop-target" : ""}`}
      aria-label={t("文本编辑区域")}
      data-drop-label={t("松开以导入 TXT")}
      onDragEnter={handleDragOver}
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
    >
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
        ref={textareaRef}
        id={textInputId}
        className={`text-editor ${textDocument.isOverLimit ? "editor-invalid" : ""}`}
        placeholder={t("在此输入需要合成为语音的文本内容...")}
        value={textDocument.text}
        onChange={(e) => textDocument.edit(e.target.value)}
        // Read-only, not disabled: the text being spoken can still be selected, copied and
        // scrolled, and focus stays put when a synthesis starts from the keyboard.
        readOnly={isGenerating}
        spellCheck={false}
        aria-describedby={noteId}
        aria-keyshortcuts="Control+Enter Meta+Enter"
      />

      {/* Always present, so the replacement is announced when the notice appears. */}
      <div className="sheet-status" role="status">
        {textDocument.replacedImport && (
          <div className="import-notice">
            <span>
              {t("已用“{name}”替换原文本。", { name: textDocument.replacedImport.fileName })}
            </span>
            <button
              type="button"
              className="btn-text"
              onClick={handleUndoImport}
              disabled={isGenerating}
            >
              {t("撤销")}
            </button>
          </div>
        )}
      </div>

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
        <div className="sheet-notes">
          <span id={noteId} className="sheet-note">
            {t("合成时，文本会发送至微软在线语音服务；edgeTTS 不保存文本。")}
          </span>
          <span className="shortcut-hint">{t("Ctrl/⌘ + Enter 合成 · Esc 取消")}</span>
        </div>
        <div className="sheet-submit">
          <span className={`char-counter ${textDocument.isOverLimit ? "counter-error" : ""}`}>
            {t("{lines} 行 · {count} / {max} 字", {
              lines: textDocument.lineCount.toLocaleString(locale),
              count: textDocument.codePointCount.toLocaleString(locale),
              max: MAX_NATIVE_INPUT_CODE_POINTS.toLocaleString(locale),
            })}
          </span>
          {actions}
        </div>
      </div>
    </section>
  );
}
