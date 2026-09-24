/**
 * Counts Unicode code points; surrogate pairs count once. Text limits are defined in code
 * points so that astral characters (emoji, rare CJK) are neither split nor double-counted.
 */
export function countCodePoints(text: string): number {
  let count = 0;
  for (let i = 0; i < text.length;) {
    const codePoint = text.codePointAt(i)!;
    i += codePoint > 0xffff ? 2 : 1;
    count++;
  }
  return count;
}
