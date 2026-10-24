import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import process from "node:process";

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
        return Number(severity) >= 7;
      }
      return (result.level ?? rule.defaultConfiguration?.level ?? "warning") === "error";
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
