import { useEffect, useMemo, useRef, useState } from "react";
import { countCodePoints, MAX_NATIVE_INPUT_CODE_POINTS } from "@edgetts/shared/limits";
import type { MessageKey } from "../i18n.js";
import { readImportedTextFile } from "../lib/text-import.js";
import { countLines } from "../lib/text-stats.js";

/** An import that replaced text, kept in memory so the replacement can be undone. */
export interface ReplacedImport {
  readonly fileName: string;
  readonly previousText: string;
}

/**
 * The text to synthesize, its statistics and local TXT import. Editing, clearing or
 * unmounting invalidates a pending import so a slow file read never overwrites newer text.
 * An import that replaces text can be undone until the text is next edited. The text never
 * leaves memory; while there is any, leaving the page asks for confirmation first.
 */
export function useTextDocument() {
  const [text, setText] = useState<string>("");
  const [importError, setImportError] = useState<MessageKey | null>(null);
  const [isImporting, setIsImporting] = useState(false);
  const [replacedImport, setReplacedImport] = useState<ReplacedImport | null>(null);
  const importGenerationIdRef = useRef<number>(0);
  const isMountedRef = useRef<boolean>(false);

  useEffect(() => {
    isMountedRef.current = true;
    return () => {
      isMountedRef.current = false;
      // Generation counter, not a DOM ref: unmount must invalidate the latest pending import.
      // eslint-disable-next-line react-hooks/exhaustive-deps
      ++importGenerationIdRef.current;
    };
  }, []);

  // Closing, reloading or navigating away would lose the text, so the browser asks first.
  const hasText = text.trim().length > 0;
  useEffect(() => {
    if (!hasText) return;
    const confirmLeave = (event: BeforeUnloadEvent): void => {
      event.preventDefault();
    };
    window.addEventListener("beforeunload", confirmLeave);
    return () => window.removeEventListener("beforeunload", confirmLeave);
  }, [hasText]);

  const codePointCount = useMemo(() => countCodePoints(text), [text]);
  const lineCount = useMemo(() => countLines(text), [text]);

  const edit = (value: string): void => {
    ++importGenerationIdRef.current;
    setIsImporting(false);
    setText(value);
    setReplacedImport(null);
    if (importError) {
      setImportError(null);
    }
  };

  const importFile = async (file: File): Promise<void> => {
    const currentGen = ++importGenerationIdRef.current;
    // Any edit while the file is read cancels the import, so this is still the text it replaces.
    const previousText = text;
    setIsImporting(true);
    const result = await readImportedTextFile(file);

    if (!isMountedRef.current || importGenerationIdRef.current !== currentGen) {
      return;
    }

    setIsImporting(false);
    if (result.success) {
      setText(result.text);
      setImportError(null);
      setReplacedImport(
        previousText.trim().length > 0 && previousText !== result.text
          ? { fileName: file.name, previousText }
          : null,
      );
    } else {
      setImportError(result.error);
    }
  };

  /** Puts back the text the last import replaced. */
  const undoImport = (): void => {
    if (!replacedImport) return;
    ++importGenerationIdRef.current;
    setIsImporting(false);
    setText(replacedImport.previousText);
    setImportError(null);
    setReplacedImport(null);
  };

  const clear = (): void => {
    ++importGenerationIdRef.current;
    setIsImporting(false);
    setText("");
    setImportError(null);
    setReplacedImport(null);
  };

  return {
    text,
    importError,
    isImporting,
    replacedImport,
    codePointCount,
    lineCount,
    isOverLimit: codePointCount > MAX_NATIVE_INPUT_CODE_POINTS,
    isEmpty: !hasText,
    edit,
    importFile,
    undoImport,
    clear,
  };
}
