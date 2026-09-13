export interface TextSegmentationOptions {
  readonly maxCodePoints: number;
}

const PARAGRAPH_REGEX = /(?:\r?\n)(?:[\t ]*\r?\n)+/g;
const LINE_REGEX = /\r?\n/g;
const SENTENCE_REGEX = /[.!?。！？;；]["'”’»›》」』】）)\]]*/gu;
const WHITESPACE_CHAR_REGEX = /[^\S\r\n]/gu;

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
 * using hierarchical natural boundaries (paragraph > line > sentence > whitespace > hard split).
 *
 * Worst-case complexity: O(N log N) via linear pre-scan followed by monotonic binary-search cursors.
 * (Where N is the number of code points; O(N) when chunk limits are non-trivial).
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

  // Phase A: Build code-point to UTF-16 offset index mapping in a single O(N) pass.
  // cpToUtf16Offset[i] is the UTF-16 offset of code point i.
  // utf16ToCp[j] is the code point index corresponding to UTF-16 offset j.
  const cpToUtf16Offset: number[] = [];
  const utf16ToCp = new Int32Array(text.length + 1);

  let cpCount = 0;
  for (let i = 0; i < text.length;) {
    cpToUtf16Offset.push(i);
    const cp = text.codePointAt(i)!;
    const cpLen = cp > 0xffff ? 2 : 1;
    for (let k = 0; k < cpLen; k++) {
      utf16ToCp[i + k] = cpCount;
    }
    i += cpLen;
    cpCount++;
  }
  cpToUtf16Offset.push(text.length);
  utf16ToCp[text.length] = cpCount;

  // Fast path: if the entire text fits within maxCodePoints, return it as a single chunk.
  if (cpCount <= options.maxCodePoints) {
    return [text];
  }

  // Phase B: Precompute all natural boundary split positions in O(N) linear scans.
  // Each array contains strictly increasing code-point positions where a split can occur.
  const paragraphEnds = collectBoundaryEnds(text, PARAGRAPH_REGEX, utf16ToCp);
  const lineEnds = collectBoundaryEnds(text, LINE_REGEX, utf16ToCp);
  const sentenceEnds = collectBoundaryEnds(text, SENTENCE_REGEX, utf16ToCp);
  const whitespaceEnds = collectBoundaryEnds(text, WHITESPACE_CHAR_REGEX, utf16ToCp);

  // Phase C: Segmentation loop using monotonic cursors and binary search.
  const chunks: string[] = [];
  let startCp = 0;

  let pCursor = 0;
  let lCursor = 0;
  let sCursor = 0;
  let wCursor = 0;

  while (startCp < cpCount) {
    const windowEndCp = Math.min(startCp + options.maxCodePoints, cpCount);

    if (windowEndCp === cpCount) {
      chunks.push(text.slice(cpToUtf16Offset[startCp]!));
      break;
    }

    // Advance cursors past any boundaries that are <= startCp
    while (pCursor < paragraphEnds.length && paragraphEnds[pCursor]! <= startCp) pCursor++;
    while (lCursor < lineEnds.length && lineEnds[lCursor]! <= startCp) lCursor++;
    while (sCursor < sentenceEnds.length && sentenceEnds[sCursor]! <= startCp) sCursor++;
    while (wCursor < whitespaceEnds.length && whitespaceEnds[wCursor]! <= startCp) wCursor++;

    // 1. Paragraph boundary (highest priority)
    let splitCp = findLatestBoundary(paragraphEnds, pCursor, windowEndCp);

    // 2. Line boundary
    if (splitCp === -1) {
      splitCp = findLatestBoundary(lineEnds, lCursor, windowEndCp);
    }

    // 3. Sentence boundary
    if (splitCp === -1) {
      splitCp = findLatestBoundary(sentenceEnds, sCursor, windowEndCp);
    }

    // 4. Whitespace boundary
    if (splitCp === -1) {
      splitCp = findLatestBoundary(whitespaceEnds, wCursor, windowEndCp);
    }

    // 5. Hard split fallback
    if (splitCp === -1) {
      splitCp = windowEndCp;
    }

    // CRLF atomicity: when maxCodePoints >= 2, prevent splitting a CRLF pair.
    // When maxCodePoints === 1, the hard size bound takes precedence and CRLF may split.
    if (options.maxCodePoints >= 2 && splitCp < cpCount) {
      const prevCode = text.charCodeAt(cpToUtf16Offset[splitCp - 1]!);
      const nextCode = text.charCodeAt(cpToUtf16Offset[splitCp]!);
      if (prevCode === 13 && nextCode === 10) {
        if (splitCp > startCp + 1) {
          splitCp -= 1;
        }
      }
    }

    chunks.push(text.slice(cpToUtf16Offset[startCp]!, cpToUtf16Offset[splitCp]!));
    startCp = splitCp;
  }

  return chunks;
}

function collectBoundaryEnds(text: string, regex: RegExp, utf16ToCp: Int32Array): number[] {
  regex.lastIndex = 0;
  const ends: number[] = [];
  let match: RegExpExecArray | null;

  while ((match = regex.exec(text)) !== null) {
    const endUtf16 = match.index + match[0].length;
    const endCp = utf16ToCp[endUtf16]!;
    if (endCp > 0 && (ends.length === 0 || ends[ends.length - 1]! !== endCp)) {
      ends.push(endCp);
    }
  }

  return ends;
}

function findLatestBoundary(
  arr: readonly number[],
  startCursor: number,
  windowEndCp: number,
): number {
  if (startCursor >= arr.length || arr[startCursor]! > windowEndCp) {
    return -1;
  }

  let low = startCursor;
  let high = arr.length - 1;
  let best = -1;

  while (low <= high) {
    const mid = (low + high) >>> 1;
    if (arr[mid]! <= windowEndCp) {
      best = arr[mid]!;
      low = mid + 1;
    } else {
      high = mid - 1;
    }
  }

  return best;
}
