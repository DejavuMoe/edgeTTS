import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import {
  cpSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import path from "node:path";
import process from "node:process";
import { performance } from "node:perf_hooks";
import { blockingFindings } from "./security/codeql-gate.mjs";

// Canary source is generated only in ignored scratch space and is never executed.
const root = path.resolve(import.meta.dirname, "..");
const mode = process.argv[2];
assert.ok(["codeql", "dependencies", "deployment"].includes(mode));
const output = path.join(root, "coverage/ci-extended", mode);
mkdirSync(output, { recursive: true });
const scratch = mkdtempSync(path.join(output, "scratch-"));
const runs = [];
let completed = false;
const pnpm = process.env.npm_execpath;
const env = Object.fromEntries(
  ["PATH", "HOME", "TMPDIR", "LANG", "DOCKER_HOST", "DOCKER_CONFIG"]
    .filter((key) => process.env[key])
    .map((key) => [key, process.env[key]]),
);
env.CI = "true";

function run(id, command, args, options = {}) {
  const started = performance.now();
  const child = spawnSync(command, args, {
    cwd: scratch,
    env,
    encoding: "utf8",
    timeout: 600_000,
    maxBuffer: 32 * 1024 * 1024,
    ...options,
  });
  const seconds = (performance.now() - started) / 1000;
  writeFileSync(path.join(output, `${id}.log`), (child.stdout ?? "") + (child.stderr ?? ""));
  assert.ifError(child.error);
  assert.equal(child.signal, null, `${id}: interrupted; not a detection`);
  assert.ok([0, 1, 2].includes(child.status), `${id}: infrastructure exit ${child.status}`);
  const result = { id, status: child.status, seconds };
  runs.push(result);
  writeFileSync(path.join(output, "runs.json"), JSON.stringify({ mode, runs }, null, 2) + "\n");
  process.stdout.write(`${id}: exit ${child.status}, ${seconds.toFixed(2)}s\n`);
  return { ...result, stdout: child.stdout, stderr: child.stderr };
}

function pass(result) {
  assert.equal(result.status, 0, `${result.id}: clean control failed; inspect its log`);
}

function write(file, content) {
  mkdirSync(path.dirname(file), { recursive: true });
  writeFileSync(file, content);
}

function codeql() {
  const cli = process.env.CODEQL;
  assert.ok(cli && path.isAbsolute(cli), "Set CODEQL to the pinned CodeQL CLI executable");
  pass(run("version", cli, ["version", "--format=json"]));
  for (const language of ["javascript", "actions"]) {
    for (const variant of [
      "clean-before",
      ...(language === "actions"
        ? ["seeded", "restricted-token"]
        : ["command-injection", "log-injection"]),
      "clean-after",
    ]) {
      const id = `${language}-${variant}`;
      const source = path.join(scratch, id);
      const seeded = variant === "seeded" || variant === "restricted-token";
      if (language === "javascript") {
        write(
          path.join(source, "server.js"),
          'const http = require("node:http");\n' +
            'const { exec } = require("node:child_process");\n' +
            "http.createServer((req, res) => {\n" +
            (variant === "command-injection" ? "  exec(req.url);\n" : "") +
            (variant === "log-injection"
              ? "  console.log(req.url);\n"
              : '  console.log("request received");\n') +
            '  res.end("ok");\n});\n',
        );
      } else {
        write(
          path.join(source, ".github/workflows/canary.yml"),
          "name: Static analysis canary only\non: issues\n" +
            (variant === "restricted-token"
              ? "permissions: {}\n"
              : "permissions:\n  contents: write\n") +
            "jobs:\n  check:\n    runs-on: ubuntu-latest\n    steps:\n" +
            (seeded
              ? '      - run: echo "${{ github.event.issue.title }}"\n'
              : '      - env:\n          TITLE: ${{ github.event.issue.title }}\n        run: printf "%s\\n" "$TITLE"\n'),
        );
      }
      const database = path.join(scratch, `${id}-db`);
      pass(
        run(`${id}-extract`, cli, [
          "database",
          "create",
          database,
          `--language=${language}`,
          `--source-root=${source}`,
          "--threads=2",
          "--ram=2048",
        ]),
      );
      const sarif = path.join(output, `${id}.sarif`);
      pass(
        run(`${id}-analyze`, cli, [
          "database",
          "analyze",
          database,
          `codeql/${language}-queries:codeql-suites/${language}-security-extended.qls`,
          "--format=sarif-latest",
          `--output=${sarif}`,
          "--threads=2",
          "--ram=2048",
        ]),
      );
      const report = JSON.parse(readFileSync(sarif, "utf8"));
      const findings = report.runs.flatMap((item) => item.results).map((item) => item.ruleId);
      const blocked = blockingFindings(report).map((item) => item.ruleId);
      const result = runs.at(-1);
      result.findings = findings;
      result.blocked = blocked;
      if (variant === "restricted-token" || variant === "log-injection") {
        assert.ok(
          findings.includes(
            variant === "restricted-token" ? "actions/code-injection/medium" : "js/log-injection",
          ),
        );
        assert.deepEqual(blocked, []);
      } else if (seeded || variant === "command-injection") {
        const expected =
          language === "javascript"
            ? "js/command-line-injection"
            : "actions/code-injection/critical";
        assert.ok(blocked.includes(expected), `${id}: expected rule ${expected}, got ${blocked}`);
      } else {
        assert.deepEqual(findings, [], `${id}: clean control produced findings`);
      }
    }
  }
}

function dependencies() {
  assert.ok(pnpm && path.isAbsolute(pnpm), "Run with pnpm experiment:ci:extended dependencies");
  pass(run("pnpm-version", pnpm, ["--version"]));
  for (const [id, scope, version] of [
    ["clean-before", "dependencies", "1.12.0"],
    ["runtime-vulnerable", "dependencies", "1.8.2"],
    ["development-vulnerable", "devDependencies", "1.8.2"],
    ["clean-after", "devDependencies", "1.12.0"],
  ]) {
    const cwd = path.join(scratch, id);
    write(
      path.join(cwd, "package.json"),
      JSON.stringify({ name: "audit-canary", private: true, [scope]: { "shell-quote": version } }),
    );
    write(path.join(cwd, "pnpm-workspace.yaml"), "packages: []\n");
    pass(run(`${id}-lock`, pnpm, ["install", "--lockfile-only", "--ignore-scripts"], { cwd }));
    cpSync(path.join(cwd, "pnpm-lock.yaml"), path.join(output, `${id}-lock.yaml`));
    const result = run(`${id}-audit`, pnpm, ["audit", "--audit-level", "high", "--json"], { cwd });
    const report = JSON.parse(result.stdout);
    assert.ok(report.metadata && report.advisories, `${id}: invalid audit response`);
    const advisories = Object.values(report.advisories).filter(
      (item) => item.module_name === "shell-quote" && ["high", "critical"].includes(item.severity),
    );
    runs.at(-1).advisories = advisories.map(
      ({ github_advisory_id, severity, vulnerable_versions }) => ({
        github_advisory_id,
        severity,
        vulnerable_versions,
      }),
    );
    if (version === "1.8.2") {
      assert.equal(result.status, 1);
      assert.ok(advisories.length, "nonzero without the seeded advisory is not a detection");
    } else pass(result);
    if (scope === "devDependencies" && version === "1.8.2") {
      // Demonstrate the blind spot of narrowing the real all-dependency gate to production.
      pass(
        run(
          "development-vulnerable-prod-only",
          pnpm,
          ["audit", "--prod", "--audit-level", "high", "--json"],
          { cwd },
        ),
      );
    }
  }
}

function deployment() {
  const image = process.env.EDGETTS_TEST_IMAGE;
  assert.ok(
    image && /^[a-z0-9/:._-]+$/.test(image),
    "Set EDGETTS_TEST_IMAGE to the freshly built image",
  );
  const writable = `edgetts:ablation-writable-${process.pid}`;
  const proxyImage = `edgetts:ablation-proxy-${process.pid}`;
  const contract = readFileSync(path.join(root, "tests/docker-runtime.mjs"), "utf8");
  const args = [
    "run",
    "--rm",
    "-i",
    "--network",
    "none",
    "--cap-drop=ALL",
    "--security-opt=no-new-privileges",
    "--memory=256m",
    "--cpus=1",
    "--pids-limit=64",
  ];
  try {
    for (const variant of ["clean-before", "root-user", "writable-code", "clean-after"]) {
      if (variant === "writable-code") {
        write(
          path.join(scratch, "Dockerfile"),
          `FROM ${image}\nUSER root\nRUN chmod 777 /app/dist/server.js\nUSER node\n`,
        );
        pass(
          run("writable-image-build", "docker", [
            "build",
            "--network=none",
            "--tag",
            writable,
            scratch,
          ]),
        );
      }
      const result = run(
        `docker-${variant}`,
        "docker",
        [
          ...args,
          ...(variant === "root-user" ? ["--user=0"] : []),
          variant === "writable-code" ? writable : image,
          "bun",
          "run",
          "-",
        ],
        { input: contract },
      );
      if (variant.startsWith("clean")) pass(result);
      else {
        assert.equal(result.status, 1);
        assert.match(
          result.stderr,
          variant === "root-user" ? /0 !== 1000/ : /Missing expected exception/,
        );
      }
    }
    // Real Node and Bun proxy controls, in addition to the image contract.
    pass(run("node-proxy-control", "bash", ["tests/provider-proxy.sh"], { cwd: root }));
    pass(run("bun-proxy-control", "bash", ["tests/provider-proxy.sh", image], { cwd: root }));
    const provider = path.join(scratch, "provider");
    cpSync(path.join(root, "packages/edge-provider/dist"), provider, { recursive: true });
    symlinkSync(
      path.join(root, "packages/edge-provider/node_modules"),
      path.join(provider, "node_modules"),
      "dir",
    );
    const proxyFile = path.join(provider, "proxy.js");
    const proxy = readFileSync(proxyFile, "utf8");
    assert.equal(proxy.split("if (bypass)").length, 2, "proxy mutation anchor must be unique");
    write(proxyFile, proxy.replace("if (bypass)", "if (false)"));
    write(
      path.join(scratch, "Dockerfile"),
      `FROM ${image}\nUSER root\nRUN sed -i 's/if (bypass)/if (false)/' /app/node_modules/@edgetts/edge-provider/dist/proxy.js\nUSER node\n`,
    );
    pass(
      run("proxy-image-build", "docker", ["build", "--network=none", "--tag", proxyImage, scratch]),
    );
    for (const runtime of ["node", "bun"]) {
      const result = run(
        `${runtime}-proxy-no-bypass`,
        "bash",
        ["tests/provider-proxy.sh", ...(runtime === "bun" ? [proxyImage] : [])],
        { cwd: root, env: { ...env, EDGETTS_PROVIDER_ENTRY: path.join(provider, "index.js") } },
      );
      assert.equal(result.status, 1);
      assert.match(result.stdout, /CONNECT and synthesis completed/);
      // The provider intentionally redacts low-level proxy errors and their credentials.
      assert.match(result.stderr, /Edge voice proxy connection failed/);
      assert.doesNotMatch(result.stdout, /NO_PROXY bypass completed/);
    }
    pass(run("node-proxy-control-after", "bash", ["tests/provider-proxy.sh"], { cwd: root }));
    pass(run("bun-proxy-control-after", "bash", ["tests/provider-proxy.sh", image], { cwd: root }));
    for (const variant of ["clean-before", "buffering-on", "wrong-upstream-uri", "clean-after"]) {
      const cwd = path.join(scratch, `nginx-${variant}`);
      const file = "deploy/nginx/edgetts.conf.example";
      let config = readFileSync(path.join(root, file), "utf8");
      if (variant === "buffering-on")
        config = config.replace("proxy_buffering off;", "proxy_buffering on;");
      if (variant === "wrong-upstream-uri")
        config = config.replace(
          "proxy_pass http://edgetts_backend;",
          "proxy_pass http://edgetts_backend/health;",
        );
      write(path.join(cwd, file), config);
      write(
        path.join(cwd, "deploy/nginx/test-proxy.sh"),
        readFileSync(path.join(root, "deploy/nginx/test-proxy.sh")),
      );
      const result = run(`nginx-${variant}`, "bash", ["deploy/nginx/test-proxy.sh"], {
        cwd,
        env: { ...env, EDGETTS_NGINX_SKIP_LIVE: "1" },
      });
      if (variant.startsWith("clean")) pass(result);
      else {
        assert.equal(result.status, 1);
        assert.match(
          result.stdout + result.stderr,
          variant === "buffering-on" ? /api_buffering_off missing/ : /Chunk 1 was NOT observed/,
        );
      }
    }
  } finally {
    spawnSync("docker", ["image", "rm", writable, proxyImage], {
      encoding: "utf8",
      timeout: 30_000,
      env,
    });
  }
}

try {
  ({ codeql, dependencies, deployment })[mode]();
  completed = true;
} finally {
  writeFileSync(
    path.join(output, "runs.json"),
    JSON.stringify(
      { mode, completed, timestamp: new Date().toISOString(), node: process.version, runs },
      null,
      2,
    ) + "\n",
  );
  rmSync(scratch, { recursive: true, force: true });
}
