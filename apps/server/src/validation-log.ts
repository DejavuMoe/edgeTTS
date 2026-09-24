export interface ValidationIssue {
  readonly code: string;
  readonly path: readonly PropertyKey[];
}

export interface ValidationIssueSummary {
  readonly code: string;
  readonly path: string;
}

/**
 * Reduces schema issues to their issue code and field path for logging.
 *
 * Zod messages and issue details (`received`, `keys`, ...) echo request values, which must
 * never reach logs. Paths are safe because the strict request schemas only contain fixed
 * field names; unrecognized keys are reported with an empty path.
 */
export function summarizeValidationIssues(
  issues: readonly ValidationIssue[],
): ValidationIssueSummary[] {
  return issues.map(({ code, path }) => ({ code, path: path.map(String).join(".") }));
}
