import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import process from "node:process";
import { fileURLToPath, URL } from "node:url";
import { groups, variants } from "./ablation.config.mjs";

const root = fileURLToPath(new URL("../../", import.meta.url));
const output = path.join(root, "coverage/ablation", new Date().toISOString().replaceAll(":", "-"));
mkdirSync(output, { recursive: true });
const config = path.join(root, "scripts/ablation/ablation.config.mjs");
const sourceFiles = [...new Set(variants.map((v) => `${groups[v.group].directory}/src/${v.file}`))];
const hashes = () =>
  Object.fromEntries(
    sourceFiles.map((file) => [
      file,
      createHash("sha256")
        .update(readFileSync(path.join(root, file)))
        .digest("hex"),
    ]),
  );
const before = hashes();
const runs = [];

function run(group, variant) {
  const id = variant?.id ?? `baseline-${group}`;
  const cwd = path.join(root, groups[group].directory);
  const reportFile = path.join(output, `${id}.json`);
  const marker = path.join(output, `${id}.applied`);
  const child = spawnSync(
    process.execPath,
    [
      path.join(cwd, "node_modules/vitest/vitest.mjs"),
      "run",
      "--config",
      config,
      "--outputFile",
      reportFile,
    ],
    {
      cwd,
      env: {
        ...process.env,
        NODE_ENV: "test",
        EDGETTS_ABLATION_GROUP: group,
        EDGETTS_ABLATION_VARIANT: variant?.id ?? "",
        EDGETTS_ABLATION_MARKER: marker,
      },
      encoding: "utf8",
      timeout: 180_000,
      maxBuffer: 16 * 1024 * 1024,
    },
  );
  writeFileSync(path.join(output, `${id}.log`), child.stdout + child.stderr);
  assert.ifError(child.error);
  assert.ok(child.status === 0 || child.status === 1, `${id}: runner exited ${child.status}`);
  const report = JSON.parse(readFileSync(reportFile, "utf8"));
  if (variant) assert.equal(readFileSync(marker, "utf8"), variant.id, "Mutation was not loaded");
  assert.ok(report.numTotalTests > 0, `${id}: no tests collected`);
  const runtime = JSON.parse(readFileSync(marker + ".runtime.json", "utf8"));
  assert.ok(["passed", "failed"].includes(runtime.reason), `${id}: test run was interrupted`);
  assert.ok(
    report.testResults.every((suite) => suite.assertionResults.length > 0),
    `${id}: test suite did not collect assertions; inspect log`,
  );
  const failures = report.testResults.flatMap((suite) =>
    suite.assertionResults
      .filter((test) => test.status === "failed")
      .map((test) => ({ name: test.fullName, messages: test.failureMessages })),
  );
  assert.equal(failures.length, report.numFailedTests, `${id}: inconsistent reporter counts`);
  if (!variant) {
    assert.equal(child.status, 0, `${id}: baseline must pass; inspect ${reportFile}`);
    assert.equal(runtime.errors.length, 0, `${id}: baseline has unhandled errors`);
  } else {
    const baseline = runs.find((item) => item.id === `baseline-${group}`);
    assert.equal(report.numTotalTests, baseline.total, `${id}: test count differs from baseline`);
  }
  const result = {
    id,
    group,
    passed: report.numPassedTests,
    failed: report.numFailedTests,
    total: report.numTotalTests,
    failures,
    runtimeErrors: runtime.errors,
    timedOutTests: failures.filter((test) =>
      test.messages.some((message) => message.includes("Test timed out")),
    ).length,
  };
  runs.push(result);
  writeFileSync(
    path.join(output, "summary.json"),
    JSON.stringify(
      { node: process.version, platform: process.platform, sourceHashes: before, variants, runs },
      null,
      2,
    ) + "\n",
  );
  process.stdout.write(
    `${id}: ${result.passed} passed, ${result.failed} failed / ${result.total}\n`,
  );
}

try {
  for (const group of Object.keys(groups)) {
    run(group);
    for (const variant of variants.filter((item) => item.group === group)) run(group, variant);
  }
} finally {
  assert.deepEqual(hashes(), before, "Experiment modified production source files");
  process.stdout.write(`Reports: ${output}\n`);
}
