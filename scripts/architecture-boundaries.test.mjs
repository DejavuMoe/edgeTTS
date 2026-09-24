// Verifies the architecture boundaries enforced by eslint.config.js.
// Probe snippets are linted as if they lived at the given paths; type information is not
// needed for import restrictions, so it is disabled to keep the check fast and file-agnostic.
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { fileURLToPath, URL } from "node:url";
import { ESLint } from "eslint";
import tseslint from "typescript-eslint";

const root = fileURLToPath(new URL("../", import.meta.url));
const eslint = new ESLint({ cwd: root, overrideConfig: tseslint.configs.disableTypeChecked });

async function restrictedImports(filePath, code) {
  const [result] = await eslint.lintText(code, { filePath });
  assert.deepEqual(
    result.messages.filter((message) => message.fatal),
    [],
    `${filePath} probe must parse`,
  );
  return result.messages.filter((message) => message.ruleId === "no-restricted-imports");
}

const FORBIDDEN = {
  "packages/tts-core/src/__probe__.ts": [
    'import "@edgetts/shared";',
    'import "@edgetts/tts-service";',
    'import "msedge-tts";',
    'import "zod";',
    'import "fastify";',
    'import "node:stream";',
  ],
  "packages/shared/src/__probe__.ts": [
    'import "@edgetts/tts-service";',
    'import "@edgetts/edge-provider";',
    'import "@edgetts/server";',
    'import "msedge-tts";',
    'import "@fastify/static";',
    'import "node:fs";',
  ],
  "packages/tts-service/src/__probe__.ts": [
    'import "@edgetts/edge-provider";',
    'import type { EdgeTtsProvider } from "@edgetts/edge-provider";',
    'export * from "msedge-tts";',
    'import "@edgetts/shared";',
    'import "zod";',
    'import "fastify";',
  ],
  "packages/edge-provider/src/__probe__.ts": [
    'import "@edgetts/tts-service";',
    'import "@edgetts/shared";',
    'import "@edgetts/server";',
    'import "fastify";',
  ],
  "apps/server/src/routes/__probe__.ts": [
    'import { EdgeTtsProvider } from "@edgetts/edge-provider";',
    'import "msedge-tts";',
    'import "@edgetts/web";',
  ],
  "apps/server/src/composition.ts": ['import { MsEdgeTTS } from "msedge-tts";'],
  "apps/web/src/__probe__.tsx": [
    'import type { TtsVoice } from "@edgetts/tts-core";',
    'import "@edgetts/tts-service";',
    'import "@edgetts/edge-provider";',
    'import "@edgetts/server";',
    'import "msedge-tts";',
    'import "fastify";',
    'import "node:fs";',
  ],
};

const ALLOWED = {
  "packages/shared/src/__probe__.ts": ['import "zod";', 'import "@edgetts/tts-core";'],
  "packages/tts-service/src/__probe__.ts": [
    'import type { TtsProvider } from "@edgetts/tts-core";',
  ],
  "packages/edge-provider/src/__probe__.ts": [
    'import "msedge-tts";',
    'import "node:stream";',
    'import type { TtsProvider } from "@edgetts/tts-core";',
  ],
  "apps/server/src/routes/__probe__.ts": [
    'import "fastify";',
    'import "@edgetts/shared";',
    'import "@edgetts/tts-service";',
  ],
  "apps/server/src/composition.ts": ['import { EdgeTtsProvider } from "@edgetts/edge-provider";'],
  "apps/web/src/__probe__.tsx": ['import "@edgetts/shared";', 'import "react";'],
  // Tests and smoke scripts may wire real providers.
  "packages/tts-service/test/__probe__.ts": ['import "@edgetts/edge-provider";'],
  "packages/tts-service/scripts/__probe__.ts": ['import "@edgetts/edge-provider";'],
};

describe("architecture boundaries", () => {
  for (const [filePath, imports] of Object.entries(FORBIDDEN)) {
    for (const code of imports) {
      it(`rejects \`${code}\` in ${filePath}`, async () => {
        const messages = await restrictedImports(filePath, code);
        assert.equal(messages.length, 1, `expected one boundary violation for ${code}`);
      });
    }
  }

  for (const [filePath, imports] of Object.entries(ALLOWED)) {
    for (const code of imports) {
      it(`allows \`${code}\` in ${filePath}`, async () => {
        assert.deepEqual(await restrictedImports(filePath, code), []);
      });
    }
  }
});
