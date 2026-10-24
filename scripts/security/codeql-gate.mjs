import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import process from "node:process";
import { fileURLToPath, URL } from "node:url";

const root = fileURLToPath(new URL("../../", import.meta.url));
const reviewed = JSON.parse(
  readFileSync(path.join(root, ".github/codeql-reviewed-findings.json"), "utf8"),
);

function isReviewed(result) {
  const location =
    result.locations?.length === 1 ? result.locations[0].physicalLocation : undefined;
  const exception = reviewed.find(
    (entry) =>
      entry.ruleId === result.ruleId &&
      entry.path === location?.artifactLocation?.uri &&
      entry.line === location?.region?.startLine,
  );
  if (!exception) return false;
  const source = readFileSync(path.join(root, exception.path), "utf8").replaceAll("\r\n", "\n");
  const hash = createHash("sha256").update(source).digest("hex");
  assert.equal(
    hash,
    exception.sourceSha256,
    "Reviewed CodeQL location changed; re-review required",
  );
  return true;
}

export function blockingFindings(sarif) {
  assert.ok(sarif.runs?.length, "Missing SARIF runs");
  return sarif.runs.flatMap((run) => {
    assert.ok(
      run.invocations?.every((item) => item.executionSuccessful),
      "Incomplete analysis",
    );
    assert.ok(Array.isArray(run.results), "Missing SARIF results");
    const rules = [
      ...(run.tool.driver.rules ?? []),
      ...(run.tool.extensions ?? []).flatMap((extension) => extension.rules ?? []),
    ];
    return run.results.filter((result) => {
      const rule = rules.find((item) => item.id === result.ruleId);
      assert.ok(rule, `Unknown rule: ${result.ruleId}`);
      const severity = rule.properties?.["security-severity"];
      if (severity !== undefined) {
        assert.ok(Number.isFinite(Number(severity)), "Invalid security severity");
        return Number(severity) >= 7 && !isReviewed(result);
      }
      return (
        (result.level ?? rule.defaultConfiguration?.level ?? "warning") === "error" &&
        !isReviewed(result)
      );
    });
  });
}

if (import.meta.main) {
  const directory = process.argv[2];
  const files = readdirSync(directory).filter((file) => file.endsWith(".sarif"));
  assert.ok(files.length, "No CodeQL SARIF files produced");
  const findings = files.flatMap((file) =>
    blockingFindings(JSON.parse(readFileSync(path.join(directory, file), "utf8"))),
  );
  // Report rule IDs only; source snippets may contain sensitive values.
  process.stdout.write(`Blocking CodeQL findings: ${findings.length}\n`);
  for (const finding of findings) process.stdout.write(`${finding.ruleId}\n`);
  if (findings.length) process.exitCode = 1;
}
