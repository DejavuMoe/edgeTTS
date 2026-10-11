import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { readFileSync } from "node:fs";
import { createServer } from "node:http";
import process from "node:process";
import { it } from "node:test";
import { URL } from "node:url";
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
