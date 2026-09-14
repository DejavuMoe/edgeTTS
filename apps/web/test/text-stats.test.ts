import { describe, it, expect } from "vitest";
import { countLines } from "../src/text-stats.js";

describe("countLines text statistics", () => {
  it("returns 0 for empty string", () => {
    expect(countLines("")).toBe(0);
  });

  it("returns 1 for single-line text without newlines", () => {
    expect(countLines("a")).toBe(1);
    expect(countLines("Hello world")).toBe(1);
    expect(countLines("   ")).toBe(1);
  });

  it("handles LF (\\n) line breaks", () => {
    expect(countLines("a\nb")).toBe(2);
    expect(countLines("line1\nline2\nline3")).toBe(3);
  });

  it("handles CRLF (\\r\\n) line breaks as a single line boundary", () => {
    expect(countLines("a\r\nb")).toBe(2);
    expect(countLines("line1\r\nline2\r\nline3")).toBe(3);
  });

  it("handles lone CR (\\r) line breaks", () => {
    expect(countLines("a\rb")).toBe(2);
    expect(countLines("line1\rline2\rline3")).toBe(3);
  });

  it("counts trailing empty lines created by trailing line endings", () => {
    expect(countLines("a\n")).toBe(2);
    expect(countLines("a\r\n")).toBe(2);
    expect(countLines("a\r")).toBe(2);
    expect(countLines("\n")).toBe(2);
    expect(countLines("\r\n")).toBe(2);
    expect(countLines("a\n\n")).toBe(3);
  });

  it("handles mixed line endings accurately", () => {
    expect(countLines("line1\r\nline2\rline3\nline4")).toBe(4);
    expect(countLines("first\r\n\nsecond\r\r\nthird")).toBe(5);
  });
});
