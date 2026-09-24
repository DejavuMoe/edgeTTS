/**
 * Failures that callers are expected to handle distinctly. Anything else from a provider is
 * an upstream failure. Adding a code obliges every exhaustive mapping to handle it.
 */
export type TtsErrorCode = "capacity_exceeded";

export class TtsError extends Error {
  readonly code: TtsErrorCode;

  constructor(code: TtsErrorCode, message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = "TtsError";
    this.code = code;
  }
}

export function isTtsError(error: unknown): error is TtsError {
  return error instanceof TtsError;
}

/** Converts an AbortSignal reason into the error to throw, preserving Error reasons as-is. */
export function createAbortError(reason?: unknown): Error {
  if (reason instanceof Error) {
    return reason;
  }
  return new DOMException(
    typeof reason === "string" ? reason : "The operation was aborted",
    "AbortError",
  );
}
