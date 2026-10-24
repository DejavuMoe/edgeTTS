import assert from "node:assert/strict";
import { test } from "node:test";
import { readFileSync, readdirSync } from "node:fs";
import { URL } from "node:url";
import { blockingFindings } from "../scripts/security/codeql-gate.mjs";
import { manifestsFromPnpm } from "../scripts/security/dependency-snapshot.mjs";

test("workflows pin external actions and keep publication behind CodeQL", () => {
  const directory = new URL("../.github/workflows/", import.meta.url);
  for (const file of readdirSync(directory)) {
    const workflow = readFileSync(new URL(file, directory), "utf8");
    assert.doesNotMatch(workflow, /^\s*pull_request_target:/m, file);
    assert.doesNotMatch(workflow, /persist-credentials: true/, file);
    for (const [, action] of workflow.matchAll(/^\s*(?:- )?uses: (\S+)/gm)) {
      assert.ok(
        action.startsWith("./") || /@[a-f0-9]{40}$/.test(action),
        `${file}: unpinned ${action}`,
      );
    }
  }
  const ci = readFileSync(new URL("ci.yml", directory), "utf8");
  assert.match(ci, / {2}publish:\r?\n[\s\S]*? {4}needs:\r?\n {6}- codeql\r?\n/);
  const codeql = readFileSync(new URL("codeql.yml", directory), "utf8");
  assert.match(codeql, /run: node scripts\/security\/codeql-gate\.mjs/);
});

const sarif = (rules, results) => ({
  runs: [{ tool: { driver: { rules } }, invocations: [{ executionSuccessful: true }], results }],
});

test("CodeQL blocks high/critical security findings and correctness errors", () => {
  const rules = [
    { id: "high", properties: { "security-severity": "7.0" } },
    { id: "critical", properties: { "security-severity": "9.8" } },
    { id: "medium", properties: { "security-severity": "6.9" } },
    { id: "bug", defaultConfiguration: { level: "error" } },
    { id: "warning" },
  ];
  assert.deepEqual(
    blockingFindings(
      sarif(
        rules,
        rules.map(({ id }) => ({ ruleId: id })),
      ),
    ).map((item) => item.ruleId),
    ["high", "critical", "bug"],
  );
  assert.deepEqual(blockingFindings(sarif([], [])), []);
});

test("CodeQL fails closed for incomplete, missing, or unrecognized results", () => {
  assert.throws(() => blockingFindings({ runs: [] }));
  const incomplete = sarif([], []);
  incomplete.runs[0].invocations[0].executionSuccessful = false;
  assert.throws(() => blockingFindings(incomplete));
  assert.throws(() => blockingFindings(sarif([], [{ ruleId: "unknown" }])));
  assert.throws(() =>
    blockingFindings(
      sarif([{ id: "bad", properties: { "security-severity": "NaN" } }], [{ ruleId: "bad" }]),
    ),
  );
});

test("CodeQL resolves rules stored in query-pack SARIF extensions", () => {
  const report = sarif([], [{ ruleId: "js/extension-rule" }]);
  report.runs[0].tool.extensions = [
    {
      rules: [{ id: "js/extension-rule", properties: { "security-severity": "8.1" } }],
    },
  ];
  assert.equal(blockingFindings(report).length, 1);
});

test("pnpm snapshot preserves versions/scopes, aliases, workspaces and transitive packages", () => {
  const leaf = { from: "@scope/leaf", version: "2.0.0" };
  const manifests = manifestsFromPnpm(
    [
      {
        path: "/repo",
        devDependencies: { leaf },
        dependencies: {
          root: { version: "1.0.0", dependencies: { leaf } },
          workspace: {
            version: "link:packages/core",
            dependencies: { optional: { version: "3.0.0" } },
          },
        },
      },
      { path: "/repo/packages/core", optionalDependencies: { leaf } },
    ],
    "/repo",
  );
  const resolved = manifests["package.json"].resolved;
  assert.equal(resolved["pkg:npm/%40scope/leaf@2.0.0"].scope, "runtime");
  assert.equal(resolved["pkg:npm/%40scope/leaf@2.0.0"].relationship, "direct");
  assert.equal(resolved["pkg:npm/optional@3.0.0"].relationship, "indirect");
  assert.equal(Object.keys(resolved).length, 3);
  assert.ok(manifests["packages/core/package.json"]);
  assert.throws(() => manifestsFromPnpm([{ path: "/outside" }], "/repo"));
  assert.throws(() =>
    manifestsFromPnpm([{ path: "/repo", dependencies: { bad: { version: "latest" } } }], "/repo"),
  );
  assert.throws(() => manifestsFromPnpm([], "/repo"));
});
