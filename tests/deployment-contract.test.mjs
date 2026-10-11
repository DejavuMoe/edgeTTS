import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import fs, { readFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { createServer } from "node:http";
import process from "node:process";
import { it } from "node:test";
import { fileURLToPath, URL } from "node:url";
import { promisify } from "node:util";

const execute = promisify(execFile);
const dockerfile = readFileSync(new URL("../Dockerfile", import.meta.url), "utf8");
const healthcheck = JSON.parse(dockerfile.match(/HEALTHCHECK[^\n]*\n\s*CMD (\[[^\n]+\])/u)[1]);

for (const status of [200, 503]) {
  it(`Docker healthcheck uses the configured PORT and respects HTTP ${status}`, async () => {
    const requests = [];
    const server = createServer((request, response) => {
      requests.push(request.url);
      response.writeHead(status).end();
    });
    await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
    try {
      assert.deepEqual(healthcheck.slice(0, 2), ["bun", "-e"]);
      // Execute the actual healthcheck program against a loopback server, without Docker.
      const exitCode = await execute(process.execPath, ["-e", healthcheck[2]], {
        env: { ...process.env, PORT: String(server.address().port) },
        timeout: 3_000,
      }).then(
        () => 0,
        (error) => error.code,
      );
      assert.equal(exitCode, status === 200 ? 0 : 1);
      assert.deepEqual(requests, ["/health"]);
    } finally {
      server.closeAllConnections();
      await new Promise((resolve) => server.close(resolve));
    }
  });
}

async function failedProxyRun(successfulStarts) {
  const fixture = fs.mkdtempSync(path.join(os.tmpdir(), "edgetts-proxy-cleanup-"));
  const bin = path.join(fixture, "bin");
  fs.mkdirSync(bin);
  const dockerLog = path.join(fixture, "docker.log");
  const cleanupLog = path.join(fixture, "cleanup.log");
  const ownedId = path.basename(fixture) + "-owned";
  const docker = [
    "#!/usr/bin/env bash",
    "set -euo pipefail",
    'printf "%s\\n" "$*" >> "$DOCKER_LOG"',
    'case "$1 $2" in',
    '  "run --rm") printf "syntax is ok\\ntest is successful\\n{\\"status\\":\\"ok\\"}\\n" ;;',
    '  "run -d")',
    '    count=0; if [ -f "$COUNTER" ]; then read -r count < "$COUNTER"; fi',
    '    count=$((count + 1)); printf "%s\\n" "$count" > "$COUNTER"',
    '    if [ "$count" -gt "$SUCCESSFUL_STARTS" ]; then exit 125; fi',
    '    printf "%s\\n" "$OWNED_ID" ;;',
    '  "inspect -f") printf "127.0.0.2\\n" ;;',
    '  "rm -f") ;;',
    "  *) exit 90 ;;",
    "esac",
  ].join("\n");
  fs.writeFileSync(path.join(bin, "docker"), docker, { mode: 0o755 });
  fs.writeFileSync(
    path.join(bin, "rm"),
    '#!/usr/bin/env bash\nprintf "%s\\n" "$@" >> "$CLEANUP_LOG"\n',
    { mode: 0o755 },
  );
  for (const name of ["openssl", "curl", "jq"]) {
    fs.writeFileSync(path.join(bin, name), "#!/usr/bin/env bash\nexit 0\n", { mode: 0o755 });
  }
  try {
    const exitCode = await execute("bash", ["deploy/nginx/test-proxy.sh"], {
      cwd: fileURLToPath(new URL("../", import.meta.url)),
      env: {
        ...process.env,
        PATH: bin + path.delimiter + process.env.PATH,
        TMPDIR: fixture,
        DOCKER_LOG: dockerLog,
        CLEANUP_LOG: cleanupLog,
        COUNTER: path.join(fixture, "counter"),
        OWNED_ID: ownedId,
        SUCCESSFUL_STARTS: String(successfulStarts),
        EDGETTS_NGINX_TEST_PORT: "0",
        EDGETTS_NGINX_SKIP_LIVE: "1",
      },
      timeout: 5_000,
    }).then(
      () => 0,
      (error) => error.code,
    );
    assert.equal(exitCode, 125, "must preserve the container startup failure");
    const commands = readFileSync(dockerLog, "utf8").trim().split("\n");
    const removed = commands
      .filter((line) => line.startsWith("rm -f "))
      .flatMap((line) => line.slice(6).split(" "));
    assert.deepEqual(removed, successfulStarts ? [ownedId] : []);
    const cleanupTargets = readFileSync(cleanupLog, "utf8")
      .trim()
      .split("\n")
      .filter((arg) => !arg.startsWith("-"));
    assert.ok(cleanupTargets.every((target) => target.startsWith(fixture + path.sep)));
    return commands
      .filter((line) => line.startsWith("run -d "))
      .map((line) => /--name (\S+)/u.exec(line)[1]);
  } finally {
    fs.rmSync(fixture, { recursive: true, force: true });
  }
}

for (const successfulStarts of [0, 1]) {
  it(
    "proxy cleanup owns only its resources after " + successfulStarts + " successful starts",
    async () => {
      const names = (
        await Promise.all([failedProxyRun(successfulStarts), failedProxyRun(successfulStarts)])
      ).flat();
      assert.equal(new Set(names).size, names.length, "concurrent runs must use different names");
    },
  );
}
