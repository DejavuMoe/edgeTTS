/**
 * Text statistics utilities for EdgeTTS Web Workbench.
 */

/**
 * Counts the number of lines in a text string.
 *
 * Rules:
 * - Empty string ("") -> 0 lines
 * - Non-empty string with no newline -> 1 line
 * - LF (\n), CRLF (\r\n), and lone CR (\r) are all treated as single line boundaries
 * - A trailing newline creates a trailing empty line (e.g. "a\n" -> 2 lines)
 */
export function countLines(text: string): number {
  if (text.length === 0) {
    return 0;
  }
  return text.split(/\r\n|\r|\n/).length;
}
