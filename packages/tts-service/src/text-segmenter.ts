export interface TextSegmentationOptions {
  readonly maxCodePoints: number;
}

const PARAGRAPH_REGEX = /(?:\r?\n)(?:[\t ]*\r?\n)+/g;
const LINE_REGEX = /\r?\n/g;
const SENTENCE_REGEX = /[.!?。！？;；]["'”’»›》」』】）)\]]*/gu;
const WHITESPACE_REGEX = /[^\S\r\n]+/gu;
const CLOSING_PUNCTUATION_REGEX = /^["'”’»›》」』】）)\]]/u;

/**
 * Counts the number of Unicode code points in a string.
 */
export function countCodePoints(str: string): number {
  let count = 0;
  for (let i = 0; i < str.length;) {
    const cp = str.codePointAt(i)!;
    i += cp > 0xffff ? 2 : 1;
    count++;
  }
  return count;
}

/**
 * Losslessly segments text into bounded chunks based on Unicode code points
 * using hierarchical natural boundaries (paragraph, line, sentence, whitespace, hard split).
 */
export function segmentText(text: string, options: TextSegmentationOptions): readonly string[] {
  if (
    options === null ||
    typeof options !== "object" ||
    typeof options.maxCodePoints !== "number" ||
    !Number.isInteger(options.maxCodePoints) ||
    options.maxCodePoints < 1
  ) {
    throw new RangeError("maxCodePoints must be a finite integer greater than 0");
  }

  if (text.length === 0) {
    return [];
  }

  // Fast path: if the entire text fits within maxCodePoints, return it as a single chunk
  if (countCodePoints(text) <= options.maxCodePoints) {
    return [text];
  }

  const chunks: string[] = [];
  let startIndex = 0;

  while (startIndex < text.length) {
    // Scan up to maxCodePoints code points for the current window
    let codePointsInWindow = 0;
    let windowEnd = startIndex;

    while (windowEnd < text.length && codePointsInWindow < options.maxCodePoints) {
      const cp = text.codePointAt(windowEnd)!;
      windowEnd += cp > 0xffff ? 2 : 1;
      codePointsInWindow++;
    }

    // If remaining text fits within the window, take the remainder
    if (windowEnd === text.length) {
      chunks.push(text.slice(startIndex));
      break;
    }

    const window = text.slice(startIndex, windowEnd);

    // Hierarchical boundary resolution:
    // 1. Paragraph boundary (highest priority)
    let splitOffset = findLatestMatchEnd(window, PARAGRAPH_REGEX);

    // 2. Line boundary
    if (splitOffset === -1) {
      splitOffset = findLatestMatchEnd(window, LINE_REGEX);
    }

    // 3. Sentence boundary
    if (splitOffset === -1) {
      splitOffset = findLatestSentenceEnd(window, text, startIndex, windowEnd);
    }

    // 4. Whitespace boundary
    if (splitOffset === -1) {
      splitOffset = findLatestMatchEnd(window, WHITESPACE_REGEX);
    }

    // 5. Hard split fallback
    if (splitOffset === -1) {
      splitOffset = window.length;
    }

    // Ensure we do not split CRLF across chunk boundaries
    if (
      splitOffset === window.length &&
      window.endsWith("\r") &&
      windowEnd < text.length &&
      text[windowEnd] === "\n"
    ) {
      if (splitOffset > 1) {
        splitOffset -= 1;
      }
    }

    chunks.push(text.slice(startIndex, startIndex + splitOffset));
    startIndex += splitOffset;
  }

  return chunks;
}

function findLatestMatchEnd(window: string, regex: RegExp): number {
  regex.lastIndex = 0;
  let latestEnd = -1;
  let match: RegExpExecArray | null;

  while ((match = regex.exec(window)) !== null) {
    const end = match.index + match[0].length;
    if (end > 0) {
      latestEnd = end;
    }
  }

  return latestEnd;
}

function findLatestSentenceEnd(
  window: string,
  fullText: string,
  startIndex: number,
  windowEnd: number,
): number {
  SENTENCE_REGEX.lastIndex = 0;
  let latestEnd = -1;
  let match: RegExpExecArray | null;

  while ((match = SENTENCE_REGEX.exec(window)) !== null) {
    const end = match.index + match[0].length;
    if (end > 0) {
      // If the match ends exactly at the window boundary and the very next character
      // in fullText is a closing punctuation mark, this sentence closing quote was truncated
      // by windowEnd. Skip this match so we don't orphan the closing quote.
      if (
        end === window.length &&
        windowEnd < fullText.length &&
        CLOSING_PUNCTUATION_REGEX.test(fullText.slice(windowEnd))
      ) {
        continue;
      }
      latestEnd = end;
    }
  }

  return latestEnd;
}
