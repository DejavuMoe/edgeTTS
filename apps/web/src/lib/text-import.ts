import type { MessageKey } from "../i18n.js";
import { countCodePoints, MAX_NATIVE_INPUT_CODE_POINTS } from "@edgetts/shared";

/**
 * Maximum allowed size for imported TXT files (256 KiB = 262,144 bytes).
 */
export const MAX_IMPORT_FILE_BYTES = 256 * 1024;

export interface TextImportSuccess {
  readonly success: true;
  readonly text: string;
}

export interface TextImportFailure {
  readonly success: false;
  readonly error: MessageKey;
}

export type TextImportResult = TextImportSuccess | TextImportFailure;

/**
 * Validates whether the given filename has a .txt extension (case-insensitive).
 */
export function isTxtFilename(filename: string): boolean {
  return filename.trim().toLowerCase().endsWith(".txt");
}

/**
 * Decodes an ArrayBuffer using strict UTF-8 decoding.
 * Throws TypeError if the buffer contains invalid UTF-8 byte sequences.
 */
export function decodeUtf8Text(buffer: ArrayBuffer): string {
  const decoder = new TextDecoder("utf-8", { fatal: true });
  return decoder.decode(buffer);
}

/**
 * Reads, validates, and decodes a local plain text file according to Phase 23 contract:
 * 1. Checks .txt extension (case-insensitive)
 * 2. Enforces <= 256 KiB before reading
 * 3. Strictly decodes as UTF-8 (fatal)
 * 4. Strips UTF-8 BOM (U+FEFF) if present at start once
 * 5. Rejects binary-like files containing NUL (U+0000)
 * 6. Enforces <= 20,000 Unicode code points
 * 7. Preserves imported text formatting, line breaks, and whitespace without modification
 */
export async function readImportedTextFile(file: File): Promise<TextImportResult> {
  if (!isTxtFilename(file.name)) {
    return { success: false, error: "仅支持 UTF-8 TXT 文件" };
  }

  if (file.size > MAX_IMPORT_FILE_BYTES) {
    return { success: false, error: "TXT 文件超过 256 KiB" };
  }

  let arrayBuffer: ArrayBuffer;
  try {
    arrayBuffer = await file.arrayBuffer();
  } catch {
    return { success: false, error: "无法读取 TXT 文件" };
  }

  let decoded: string;
  try {
    decoded = decodeUtf8Text(arrayBuffer);
  } catch {
    return { success: false, error: "TXT 文件不是有效的 UTF-8 文本" };
  }

  // Strip single leading UTF-8 BOM if present
  let text = decoded;
  if (text.startsWith("\uFEFF")) {
    text = text.slice(1);
  }

  // Reject binary-like content containing NUL byte
  if (text.includes("\u0000")) {
    return { success: false, error: "文件内容不是有效的纯文本" };
  }

  // Enforce native 20,000 Unicode code-point limit
  const codePoints = countCodePoints(text);
  if (codePoints > MAX_NATIVE_INPUT_CODE_POINTS) {
    return { success: false, error: "TXT 内容超过 20,000 字符上限" };
  }

  return { success: true, text };
}
