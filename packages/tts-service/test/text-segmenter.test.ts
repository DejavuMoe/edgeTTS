import { describe, it, expect } from "vitest";
import { countCodePoints, segmentText } from "../src/index.js";

function expectLosslessSegmentation(text: string, maxCodePoints: number): readonly string[] {
  const chunks = segmentText(text, { maxCodePoints });
  expect(chunks.join("")).toBe(text);

  if (text === "") {
    expect(chunks).toEqual([]);
  } else {
    expect(chunks.length).toBeGreaterThan(0);
    for (const chunk of chunks) {
      expect(chunk.length).toBeGreaterThan(0);
      expect(countCodePoints(chunk)).toBeLessThanOrEqual(maxCodePoints);
    }
  }

  return chunks;
}

describe("TextSegmenter", () => {
  describe("options validation", () => {
    it("rejects invalid maxCodePoints with RangeError", () => {
      const invalidValues = [0, -1, -100, 1.5, NaN, Infinity, -Infinity];
      for (const invalid of invalidValues) {
        expect(() => segmentText("hello", { maxCodePoints: invalid })).toThrowError(RangeError);
      }
    });

    it("accepts valid positive integer maxCodePoints", () => {
      const validValues = [1, 10, 1000, 4096];
      for (const valid of validValues) {
        expect(() => segmentText("hello", { maxCodePoints: valid })).not.toThrow();
      }
    });
  });

  describe("empty and short inputs", () => {
    it("returns empty array for empty input", () => {
      const chunks = segmentText("", { maxCodePoints: 10 });
      expect(chunks).toEqual([]);
    });

    it("returns single chunk for short input within limit", () => {
      const chunks = expectLosslessSegmentation("Hello world.", 100);
      expect(chunks).toEqual(["Hello world."]);
    });

    it("returns single chunk when input length exactly equals maxCodePoints", () => {
      const text = "1234567890";
      const chunks = expectLosslessSegmentation(text, 10);
      expect(chunks).toEqual([text]);
      expect(chunks.length).toBe(1);
    });

    it("splits into max and 1 when input is exactly maxCodePoints + 1 without boundaries", () => {
      const text = "ABCDEF";
      const chunks = expectLosslessSegmentation(text, 5);
      expect(chunks).toEqual(["ABCDE", "F"]);
      expect(countCodePoints(chunks[0]!)).toBe(5);
      expect(countCodePoints(chunks[1]!)).toBe(1);
    });
  });

  describe("boundary priority", () => {
    it("prefers paragraph boundary over line, sentence, and whitespace even if paragraph occurs earlier", () => {
      // Paragraph break at index 16..18. Later in the window has a sentence break '.' and space.
      const text = "First paragraph.\n\nSecond paragraph has a sentence. And more words here.";
      const chunks = expectLosslessSegmentation(text, 40);
      expect(chunks[0]).toBe("First paragraph.\n\n");
      expect(chunks[0]?.endsWith("\n\n")).toBe(true);
    });

    it("prefers line boundary over sentence and whitespace when no paragraph boundary is available", () => {
      const text = "First line sentence.\nSecond line with several more words.";
      const chunks = expectLosslessSegmentation(text, 30);
      expect(chunks[0]).toBe("First line sentence.\n");
      expect(chunks[0]?.endsWith("\n")).toBe(true);
    });

    it("prefers sentence boundary over whitespace when no paragraph or line boundary is available", () => {
      const text = "Hello world. This is a long sentence with many words";
      const chunks = expectLosslessSegmentation(text, 25);
      expect(chunks[0]).toBe("Hello world.");
      expect(chunks[1]?.startsWith(" ")).toBe(true);
    });

    it("falls back to whitespace boundary when no paragraph, line, or sentence boundary is available", () => {
      const text = "wordone wordtwo wordthree wordfour";
      const chunks = expectLosslessSegmentation(text, 20);
      expect(chunks[0]).toBe("wordone wordtwo ");
      expect(chunks[1]).toBe("wordthree wordfour");
    });

    it("falls back to hard split when no natural boundaries exist", () => {
      const text = "ABCDEFGHIJKLMNOPQRSTUVWXYZ";
      const chunks = expectLosslessSegmentation(text, 10);
      expect(chunks).toEqual(["ABCDEFGHIJ", "KLMNOPQRST", "UVWXYZ"]);
    });
  });

  describe("punctuation and quote handling", () => {
    it("supports Chinese sentence punctuation (。！？；)", () => {
      const text = "第一句话。第二句话！第三句话？第四句话；第五句话。";
      const chunks = expectLosslessSegmentation(text, 6);
      expect(chunks[0]).toBe("第一句话。");
      expect(chunks[1]).toBe("第二句话！");
      expect(chunks[2]).toBe("第三句话？");
      expect(chunks[3]).toBe("第四句话；");
      expect(chunks[4]).toBe("第五句话。");
    });

    it("supports English sentence punctuation (.!?;)", () => {
      const text = "One sentence. Another sentence! A question? A clause; the end.";
      const chunks = expectLosslessSegmentation(text, 18);
      expect(chunks[0]).toBe("One sentence.");
      expect(chunks[1]).toBe(" Another sentence!");
      expect(chunks[2]).toBe(" A question?");
    });

    it("keeps closing quotes attached to the preceding sentence punctuation", () => {
      const enText = 'He said "hello." Then continued.';
      const enChunks = expectLosslessSegmentation(enText, 20);
      expect(enChunks[0]).toBe('He said "hello."');
      expect(enChunks[1]).toBe(" Then continued.");

      const zhText = "他说：“你好。”然后继续。";
      const zhChunks = expectLosslessSegmentation(zhText, 10);
      expect(zhChunks[0]).toBe("他说：“你好。”");
      expect(zhChunks[1]).toBe("然后继续。");
    });

    it("handles multiple nested closing quotes and brackets", () => {
      const text = 'She said, "(Wait!)" Then she left.';
      const chunks = expectLosslessSegmentation(text, 25);
      expect(chunks[0]).toBe('She said, "(Wait!)"');
      expect(chunks[1]).toBe(" Then she left.");
    });
  });

  describe("CRLF and whitespace preservation", () => {
    it("never splits a CRLF pair across chunk boundaries in line breaks", () => {
      const text = "line1\r\nline2\r\nline3";
      const chunks = expectLosslessSegmentation(text, 10);
      for (let i = 0; i < chunks.length - 1; i++) {
        expect(chunks[i]?.endsWith("\r")).toBe(false);
      }
      expect(chunks[0]).toBe("line1\r\n");
      expect(chunks[1]).toBe("line2\r\n");
      expect(chunks[2]).toBe("line3");
    });

    it("never splits a CRLF pair in paragraph breaks", () => {
      const text = "paragraph1\r\n\r\nparagraph2";
      const chunks = expectLosslessSegmentation(text, 16);
      expect(chunks[0]).toBe("paragraph1\r\n\r\n");
      expect(chunks[1]).toBe("paragraph2");
      for (let i = 0; i < chunks.length - 1; i++) {
        expect(chunks[i]?.endsWith("\r")).toBe(false);
      }
    });

    it("never splits CRLF in hard split when window ends on \\r", () => {
      const text = "abcdefg\r\nhijklmn";
      const chunks = expectLosslessSegmentation(text, 8);
      // Window of 8 is "abcdefg\r" followed by \n in text. Must not split \r\n!
      expect(chunks[0]).toBe("abcdefg");
      expect(chunks[1]).toBe("\r\n");
      expect(chunks[2]).toBe("hijklmn");
      for (let i = 0; i < chunks.length - 1; i++) {
        expect(chunks[i]?.endsWith("\r")).toBe(false);
      }
    });

    it("preserves whitespace-only input losslessly", () => {
      const spaces = "     ";
      const shortChunks = expectLosslessSegmentation(spaces, 10);
      expect(shortChunks).toEqual(["     "]);

      const longSpaces = "          ";
      const splitChunks = expectLosslessSegmentation(longSpaces, 3);
      expect(splitChunks.join("")).toBe(longSpaces);
      for (const chunk of splitChunks) {
        expect(countCodePoints(chunk)).toBeLessThanOrEqual(3);
      }
    });

    it("preserves leading, trailing, and multiple consecutive whitespace losslessly", () => {
      const text = "  leading  multiple   spaces\tand\ttabs\n\nand newlines  ";
      const chunks = expectLosslessSegmentation(text, 15);
      expect(chunks.join("")).toBe(text);
    });
  });

  describe("Unicode and emoji handling", () => {
    it("measures limit in Unicode code points without corrupting surrogate pairs", () => {
      const text = "😀😀😀😀😀";
      // 5 emojis = 5 code points = 10 UTF-16 code units
      const chunks = expectLosslessSegmentation(text, 2);
      expect(chunks).toEqual(["😀😀", "😀😀", "😀"]);
      for (const chunk of chunks) {
        expect(countCodePoints(chunk)).toBeLessThanOrEqual(2);
      }
    });

    it("handles mixed multilingual text with emojis and varied punctuation", () => {
      const text = "Hello 世界。This is a test! 🚀 下一句？End.";
      const chunks = expectLosslessSegmentation(text, 15);
      expect(chunks.join("")).toBe(text);
      for (const chunk of chunks) {
        expect(countCodePoints(chunk)).toBeLessThanOrEqual(15);
      }
    });
  });

  describe("scale and determinism", () => {
    it("efficiently segments 100k unbroken text", () => {
      const text = "A".repeat(100_000);
      const chunks = expectLosslessSegmentation(text, 1000);
      expect(chunks.length).toBe(100);
      for (const chunk of chunks) {
        expect(chunk.length).toBe(1000);
      }
      expect(chunks.join("")).toBe(text);
    });

    it("produces strictly deterministic output across repeated runs", () => {
      const text = "Stable text. With multiple lines\nand sentences! For verification.";
      const run1 = segmentText(text, { maxCodePoints: 20 });
      const run2 = segmentText(text, { maxCodePoints: 20 });
      expect(run1).toEqual(run2);
    });
  });
});
