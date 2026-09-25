import { useEffect, useMemo, useRef, useState } from "react";
import { countCodePoints, MAX_NATIVE_INPUT_CODE_POINTS } from "@edgetts/shared";
import type { MessageKey } from "../i18n.js";
import { readImportedTextFile } from "../text-import.js";
import { countLines } from "../text-stats.js";

/**
 * The text to synthesize, its statistics and local TXT import. Editing, clearing or
 * unmounting invalidates a pending import so a slow file read never overwrites newer text.
 */
export function useTextDocument() {
  const [text, setText] = useState<string>("");
  const [importError, setImportError] = useState<MessageKey | null>(null);
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

  const codePointCount = useMemo(() => countCodePoints(text), [text]);
  const lineCount = useMemo(() => countLines(text), [text]);

  const edit = (value: string): void => {
    ++importGenerationIdRef.current;
    setText(value);
    if (importError) {
      setImportError(null);
    }
  };

  const importFile = async (file: File): Promise<void> => {
    const currentGen = ++importGenerationIdRef.current;
    const result = await readImportedTextFile(file);

    if (!isMountedRef.current || importGenerationIdRef.current !== currentGen) {
      return;
    }

    if (result.success) {
      setText(result.text);
      setImportError(null);
    } else {
      setImportError(result.error);
    }
  };

  const clear = (): void => {
    ++importGenerationIdRef.current;
    setText("");
    setImportError(null);
  };

  return {
    text,
    importError,
    codePointCount,
    lineCount,
    isOverLimit: codePointCount > MAX_NATIVE_INPUT_CODE_POINTS,
    isEmpty: text.trim().length === 0,
    edit,
    importFile,
    clear,
  };
}
