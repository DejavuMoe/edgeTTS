import { describe, it, expect, vi } from "vitest";
import {
  MAX_IMPORT_FILE_BYTES,
  isTxtFilename,
  decodeUtf8Text,
  readImportedTextFile,
} from "../../src/lib/text-import.js";

describe("isTxtFilename", () => {
  it("accepts lowercase .txt extension", () => {
    expect(isTxtFilename("speech.txt")).toBe(true);
    expect(isTxtFilename("my-file.txt")).toBe(true);
    expect(isTxtFilename(".txt")).toBe(true);
  });

  it("accepts uppercase or mixed-case .TXT extension", () => {
    expect(isTxtFilename("SCRIPT.TXT")).toBe(true);
    expect(isTxtFilename("document.Txt")).toBe(true);
    expect(isTxtFilename("audio.tXt")).toBe(true);
  });

  it("rejects non-txt extensions", () => {
    expect(isTxtFilename("readme.md")).toBe(false);
    expect(isTxtFilename("document.doc")).toBe(false);
    expect(isTxtFilename("data.docx")).toBe(false);
    expect(isTxtFilename("file.pdf")).toBe(false);
    expect(isTxtFilename("index.html")).toBe(false);
    expect(isTxtFilename("payload.json")).toBe(false);
    expect(isTxtFilename("image.png")).toBe(false);
    expect(isTxtFilename("binary")).toBe(false);
    expect(isTxtFilename("txt")).toBe(false);
    expect(isTxtFilename("")).toBe(false);
  });
});

describe("decodeUtf8Text", () => {
  it("decodes valid UTF-8 ArrayBuffer cleanly", () => {
    const encoder = new TextEncoder();
    const buffer = encoder.encode("你好世界 Hello World! 🚀").buffer;
    expect(decodeUtf8Text(buffer)).toBe("你好世界 Hello World! 🚀");
  });

  it("throws TypeError on invalid UTF-8 byte sequences", () => {
    // 0xFF and 0xFE are invalid starting bytes in UTF-8
    const invalidBytes = new Uint8Array([0xff, 0xfe, 0x80]);
    expect(() => decodeUtf8Text(invalidBytes.buffer)).toThrow(TypeError);
  });
});

describe("readImportedTextFile", () => {
  function makeTxtFile(content: string | Uint8Array<ArrayBuffer>, filename = "test.txt"): File {
    return new File([content], filename, { type: "text/plain" });
  }

  it("accepts valid UTF-8 .txt files", async () => {
    const file = makeTxtFile("Sample speech text 示例内容");
    const result = await readImportedTextFile(file);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.text).toBe("Sample speech text 示例内容");
    }
  });

  it("accepts uppercase .TXT filenames", async () => {
    const file = makeTxtFile("Valid content", "SAMPLE.TXT");
    const result = await readImportedTextFile(file);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.text).toBe("Valid content");
    }
  });

  it("rejects files without .txt extension", async () => {
    const file = makeTxtFile("markdown text", "notes.md");
    const result = await readImportedTextFile(file);
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error).toBe("仅支持 UTF-8 TXT 文件");
    }
  });

  it("accepts files <= 256 KiB", async () => {
    // 10,000 bytes is well within 256 KiB and 20,000 code point limit
    const smallBytes = new Uint8Array(10_000).fill(0x61);
    const validFile = makeTxtFile(smallBytes, "10k.txt");
    expect(validFile.size).toBeLessThanOrEqual(MAX_IMPORT_FILE_BYTES);
    const result = await readImportedTextFile(validFile);
    expect(result.success).toBe(true);
  });

  it("rejects files exceeding 256 KiB before decoding without reading arrayBuffer", async () => {
    const oversizeBytes = new Uint8Array(MAX_IMPORT_FILE_BYTES + 1).fill(0x61);
    const file = makeTxtFile(oversizeBytes, "oversize.txt");
    const arrayBufferSpy = vi.spyOn(file, "arrayBuffer");

    const result = await readImportedTextFile(file);
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error).toBe("TXT 文件超过 256 KiB");
    }
    expect(arrayBufferSpy).not.toHaveBeenCalled();
  });

  it("rejects invalid UTF-8 byte sequences", async () => {
    const invalidBytes = new Uint8Array([0x48, 0x65, 0x6c, 0x6c, 0x6f, 0xff, 0xfe]);
    const file = makeTxtFile(invalidBytes, "invalid.txt");
    const result = await readImportedTextFile(file);
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error).toBe("TXT 文件不是有效的 UTF-8 文本");
    }
  });

  it("removes UTF-8 BOM (U+FEFF) once at the start", async () => {
    const bomBytes = new Uint8Array([0xef, 0xbb, 0xbf, 0x48, 0x65, 0x6c, 0x6c, 0x6f]); // BOM + "Hello"
    const file = makeTxtFile(bomBytes, "with-bom.txt");
    const result = await readImportedTextFile(file);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.text).toBe("Hello");
      expect(result.text.charCodeAt(0)).toBe(0x48); // 'H', not BOM
    }
  });

  it("preserves leading and trailing whitespace without trimming", async () => {
    const file = makeTxtFile("  \n\t leading and trailing \t\n  ");
    const result = await readImportedTextFile(file);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.text).toBe("  \n\t leading and trailing \t\n  ");
    }
  });

  it("rejects binary-like TXT files containing NUL byte (U+0000)", async () => {
    const nulBytes = new Uint8Array([0x48, 0x65, 0x00, 0x6c, 0x6f]); // "He\0lo"
    const file = makeTxtFile(nulBytes, "binary.txt");
    const result = await readImportedTextFile(file);
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error).toBe("文件内容不是有效的纯文本");
    }
  });

  it("accepts exactly 20,000 Unicode code points", async () => {
    const exactly20k = "a".repeat(20_000);
    const file = makeTxtFile(exactly20k, "exact20k.txt");
    const result = await readImportedTextFile(file);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.text.length).toBe(20_000);
    }
  });

  it("rejects 20,001 Unicode code points", async () => {
    const over20k = "a".repeat(20_001);
    const file = makeTxtFile(over20k, "over20k.txt");
    const result = await readImportedTextFile(file);
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error).toBe("TXT 内容超过 20,000 字符上限");
    }
  });

  it("counts supplementary Unicode characters (surrogate pairs) accurately", async () => {
    // 🚀 is 2 UTF-16 code units but 1 Unicode code point
    const emoji20k = "🚀".repeat(20_000);
    expect(emoji20k.length).toBe(40_000); // 40k UTF-16 code units
    const file = makeTxtFile(emoji20k, "emoji20k.txt");
    const result = await readImportedTextFile(file);
    expect(result.success).toBe(true);

    const emoji20kPlusOne = "🚀".repeat(20_001);
    const overFile = makeTxtFile(emoji20kPlusOne, "emojiOver.txt");
    const overResult = await readImportedTextFile(overFile);
    expect(overResult.success).toBe(false);
    if (!overResult.success) {
      expect(overResult.error).toBe("TXT 内容超过 20,000 字符上限");
    }
  });

  it("accepts empty TXT file", async () => {
    const file = makeTxtFile("", "empty.txt");
    const result = await readImportedTextFile(file);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.text).toBe("");
    }
  });

  it("accepts whitespace-only TXT file", async () => {
    const file = makeTxtFile("   \n\n\t  ", "spaces.txt");
    const result = await readImportedTextFile(file);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.text).toBe("   \n\n\t  ");
    }
  });

  it("returns error message when arrayBuffer() throws", async () => {
    const file = makeTxtFile("text", "error.txt");
    vi.spyOn(file, "arrayBuffer").mockRejectedValueOnce(new Error("Disk read failure"));
    const result = await readImportedTextFile(file);
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error).toBe("无法读取 TXT 文件");
    }
  });
});
