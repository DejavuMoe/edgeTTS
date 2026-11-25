import { useEffect, useRef } from "react";

/** Input types where the user types text, so Enter keeps its meaning for that field. */
const NON_TEXT_INPUT_TYPES = new Set([
  "button",
  "checkbox",
  "color",
  "file",
  "image",
  "radio",
  "range",
  "reset",
  "submit",
]);

/**
 * Ctrl+Enter (⌘+Enter on macOS) synthesizes from anywhere on the page, so a voice or setting
 * can be changed and the text heard again without returning to the text. Other text fields
 * such as the voice search and the API key keep the keys to themselves, as do dialogs, links
 * (where the browser opens them in a new tab) and any control that already handled the press.
 */
export function useGenerateShortcut(onGenerate: () => void): void {
  const latest = useRef(onGenerate);
  useEffect(() => {
    latest.current = onGenerate;
  });

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent): void => {
      if (e.key !== "Enter" || !(e.ctrlKey || e.metaKey)) return;
      if (e.defaultPrevented || e.isComposing || keepsEnter(e.target)) return;
      e.preventDefault();
      latest.current();
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, []);
}

function keepsEnter(target: EventTarget | null): boolean {
  if (!(target instanceof Element)) return false;
  if (target.closest("dialog, a[href]")) return true;
  if (target instanceof HTMLInputElement) return !NON_TEXT_INPUT_TYPES.has(target.type);
  return target instanceof HTMLElement && target.isContentEditable;
}
