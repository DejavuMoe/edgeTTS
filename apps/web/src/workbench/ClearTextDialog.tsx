import type { RefObject } from "react";
import { useI18n } from "../i18n.js";

export interface ClearTextDialogProps {
  readonly dialogRef: RefObject<HTMLDialogElement | null>;
  readonly onConfirm: () => void;
}

export function ClearTextDialog({ dialogRef, onConfirm }: ClearTextDialogProps) {
  const { t } = useI18n();
  return (
    <dialog
      ref={dialogRef}
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
          onClick={() => dialogRef.current?.close()}
        >
          {t("取消")}
        </button>
        <button type="button" className="btn btn-primary" onClick={onConfirm}>
          {t("确认清空")}
        </button>
      </div>
    </dialog>
  );
}
