import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  cpSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import path from "node:path";
import process from "node:process";
import { performance } from "node:perf_hooks";

// Deliberately separate from scripts/ablation: this experiment removes CI checks.
const root = path.resolve(import.meta.dirname, "..");
const parallel = process.argv.includes("--parallel");
const output = path.join(root, parallel ? "coverage/ci-ablation-parallel" : "coverage/ci-ablation");
const pnpm = process.env.npm_execpath;
assert.ok(pnpm && path.isAbsolute(pnpm), "Run with pnpm experiment:ci");
mkdirSync(output, { recursive: true });
rmSync(path.join(output, "report.md"), { force: true });
const checks = parallel ? ["ci:parallel"] : ["build", "typecheck", "lint", "test", "format:check"];
const fixtures = [
  ["missing-web-entry", "apps/web/index.html", "/src/main.tsx", "/src/missing.tsx"],
  [
    "test-type-error",
    "apps/server/test/health.test.ts",
    "public listVoicesCalls = 0;",
    "public listVoicesCalls: string = 0;",
  ],
  [
    "unused-variable",
    "apps/server/src/routes/health.ts",
    "const payload: HealthResponse",
    "const unused = 1;\n    const payload: HealthResponse",
  ],
  ["wrong-http-status", "apps/server/src/routes/health.ts", "reply.code(200)", "reply.code(201)"],
  ["format-drift", "packages/tts-core/src/text.ts", "let count = 0;", "let count=0;"],
  ["broken-doc-link", "README.md", "#", "[Missing guide](docs/missing-guide.md)\n\n#"],
];
const originals = new Map(fixtures.map(([, file]) => [file, readFileSync(path.join(root, file))]));
const digest = (data) => createHash("sha256").update(data).digest("hex");
const runs = [];

function runFixture(fixture) {
  const [id, file, before, after] = fixture;
  const scratch = mkdtempSync(path.join(output, "scratch-"));
  const workspace = path.join(scratch, "workspace");
  try {
    mkdirSync(workspace);
    const copyOptions = {
      recursive: true,
      verbatimSymlinks: true,
      filter: (source) =>
        path.relative(root, source).split(path.sep).includes("node_modules") ||
        (![".git", "coverage", "dist", ".npmrc"].includes(path.basename(source)) &&
          (!path.basename(source).startsWith(".env") || path.basename(source) === ".env.example")),
    };
    for (const entry of readdirSync(root)) {
      if ([".git", "coverage", "dist"].includes(entry)) continue;
      cpSync(path.join(root, entry), path.join(workspace, entry), copyOptions);
    }
    // pnpm 12 otherwise reinstalls after relocation, contaminating command timings.
    const config = path.join(workspace, "pnpm-workspace.yaml");
    const settings = readFileSync(config, "utf8");
    assert.ok(!settings.includes("verifyDepsBeforeRun:"), "Review experiment installation setup");
    writeFileSync(config, settings + "verifyDepsBeforeRun: false\n");
    if (file) {
      const target = path.join(workspace, file);
      let source = readFileSync(target, "utf8");
      assert.ok(source.includes(before), `${id}: mutation anchor missing`);
      // The documentation fixture deliberately inserts at the first heading only.
      if (id !== "broken-doc-link")
        assert.equal(source.split(before).length, 2, `${id}: ambiguous mutation`);
      source = source.replace(before, after);
      writeFileSync(target, source);
    }
    const env = {
      // Reuse the pinned executable; a global launcher would download pnpm into each HOME.
      PATH: path.dirname(pnpm) + path.delimiter + process.env.PATH,
      HOME: scratch,
      TMPDIR: scratch,
      CI: "true",
      LANG: "C.UTF-8",
    };
    const results = [];
    for (const check of checks) {
      const started = performance.now();
      const child = spawnSync(pnpm, [check], {
        cwd: workspace,
        env,
        encoding: "utf8",
        timeout: 300_000,
        maxBuffer: 32 * 1024 * 1024,
      });
      const seconds = (performance.now() - started) / 1000;
      writeFileSync(
        path.join(output, `${id}-${check.replace(":", "-")}.log`),
        (child.stdout ?? "") + (child.stderr ?? ""),
      );
      assert.ifError(child.error);
      assert.equal(child.signal, null, `${id}/${check}: interrupted`);
      assert.ok(
        [0, 1, 2].includes(child.status),
        `${id}/${check}: unexpected exit ${child.status}`,
      );
      if (!file) assert.equal(child.status, 0, `${id}/${check}: baseline failed; inspect logs`);
      results.push({ check, passed: child.status === 0, seconds });
      process.stdout.write(
        `${id}: ${check} ${child.status === 0 ? "pass" : "detect"} ${seconds.toFixed(2)}s\n`,
      );
    }
    runs.push({ id, results });
  } finally {
    rmSync(scratch, { recursive: true, force: true });
  }
}

try {
  runFixture(["baseline-before"]);
  for (const fixture of fixtures) runFixture(fixture);
  runFixture(["baseline-after"]);
} finally {
  for (const [file, content] of originals)
    assert.equal(
      digest(readFileSync(path.join(root, file))),
      digest(content),
      `Canonical source changed: ${file}`,
    );
  writeFileSync(
    path.join(output, "runs.json"),
    JSON.stringify(
      {
        schedule: parallel ? "build-then-parallel" : "sequential",
        checks,
        fixtures: fixtures.map(([id, file]) => ({ id, file })),
        runs,
      },
      null,
      2,
    ) + "\n",
  );
}

const baselines = runs.filter((run) => run.id.startsWith("baseline-"));
const mutations = runs.filter((run) => !run.id.startsWith("baseline-"));
const costs = Object.fromEntries(
  checks.map((check) => [
    check,
    baselines.reduce(
      (sum, run) => sum + run.results.find((result) => result.check === check).seconds,
      0,
    ) / baselines.length,
  ]),
);
const rows = [null, ...checks].map((removed) => {
  const survivors = mutations.filter((run) =>
    run.results.filter((result) => result.check !== removed).every((result) => result.passed),
  );
  return {
    removed: removed ?? "none",
    caught: mutations.length - survivors.length,
    escaped: survivors.map((run) => run.id),
    seconds: Object.entries(costs)
      .filter(([check]) => check !== removed)
      .reduce((sum, [, cost]) => sum + cost, 0),
  };
});
assert.equal(rows[0].caught, fixtures.length, "Baseline suite missed a seeded defect");
const report = [
  "# CI check ablation",
  "",
  "Measured commands on fresh disposable copies; two clean baselines bracket the seeded runs. Each check runs even after a failure. Leave-one-out rows discard one check's verdict from the observed matrix, not separate GitHub workflow executions.",
  "",
  "Time is the mean clean command duration summed sequentially; install, runner queue, Docker, proxy, network audit, CodeQL and publication are excluded. It is not end-to-end CI latency. Six fixtures are a small purposive sample, not a security or real-world defect detection rate.",
  "Build supplies artifacts to later checks. Removing its verdict does not mean build execution can be removed; the omitted duration is only an upper bound on savings until prerequisite builds are accounted for. pnpm auto-install is disabled only in the disposable copies.",
  "",
  "| Removed check | Seeded defects caught | Escaped fixtures | Clean command time (s) |",
  "| --- | --- | --- | --- |",
  ...rows.map(
    (row) =>
      `| ${row.removed} | ${row.caught}/${fixtures.length} | ${row.escaped.join(", ") || "none"} | ${row.seconds.toFixed(2)} |`,
  ),
  "",
  `| Fixture | ${checks.join(" | ")} |`,
  `| --- | ${checks.map(() => "---").join(" | ")} |`,
  ...mutations.map(
    (run) =>
      `| ${run.id} | ${run.results.map((result) => (result.passed ? "pass" : "detected")).join(" | ")} |`,
  ),
  "",
  "No production CI gate is removed by this experiment. A redundant detection in this sample does not establish that a check is unnecessary.",
  "",
].join("\n");
writeFileSync(path.join(output, "report.md"), report);
process.stdout.write(report);
