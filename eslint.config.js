import js from "@eslint/js";
import reactHooks from "eslint-plugin-react-hooks";
import tseslint from "typescript-eslint";

const HTTP_FRAMEWORK = ["fastify", "@fastify/*"];
const APPLICATIONS = ["@edgetts/server", "@edgetts/web"];

// Architecture boundaries from AGENTS.md. Later entries override earlier ones for the same file.
const ARCHITECTURE_BOUNDARIES = [
  {
    files: ["packages/tts-core/src/**/*.ts"],
    message:
      "tts-core is the provider-neutral domain: no workspace, provider, HTTP, schema or Node.js dependencies.",
    group: ["@edgetts/*", "msedge-tts", "zod", "node:*", ...HTTP_FRAMEWORK],
  },
  {
    files: ["packages/shared/src/**/*.ts"],
    message:
      "shared holds browser-safe HTTP contracts: it must not depend on the service, providers, applications, HTTP frameworks or Node.js.",
    group: [
      "@edgetts/tts-service",
      "@edgetts/edge-provider",
      "msedge-tts",
      "node:*",
      ...APPLICATIONS,
      ...HTTP_FRAMEWORK,
    ],
  },
  {
    files: ["packages/tts-service/src/**/*.ts"],
    message:
      "tts-service depends only on tts-core interfaces; providers are injected by apps/server/src/composition.ts.",
    group: [
      "@edgetts/edge-provider",
      "@edgetts/shared",
      "msedge-tts",
      "zod",
      ...APPLICATIONS,
      ...HTTP_FRAMEWORK,
    ],
  },
  {
    files: ["packages/edge-provider/src/**/*.ts"],
    message:
      "edge-provider implements tts-core ports only; it must not depend on the service, HTTP contracts or applications.",
    group: ["@edgetts/tts-service", "@edgetts/shared", "zod", ...APPLICATIONS, ...HTTP_FRAMEWORK],
  },
  {
    files: ["apps/server/src/**/*.ts"],
    message:
      "HTTP code must reach providers only through TtsService; only composition.ts may construct EdgeTtsProvider.",
    group: ["@edgetts/edge-provider", "msedge-tts", "@edgetts/web"],
  },
  {
    files: ["apps/server/src/composition.ts"],
    message: "The composition root wires EdgeTtsProvider; it must not import msedge-tts directly.",
    group: ["msedge-tts", "@edgetts/web"],
  },
  {
    files: ["apps/web/src/**/*.{ts,tsx}"],
    message:
      "The browser workbench talks to the server over HTTP and may import only @edgetts/shared.",
    group: [
      "@edgetts/tts-core",
      "@edgetts/tts-service",
      "@edgetts/edge-provider",
      "@edgetts/server",
      "msedge-tts",
      "node:*",
      ...HTTP_FRAMEWORK,
    ],
  },
].map(({ files, message, group }) => ({
  files,
  rules: {
    "no-restricted-imports": ["error", { patterns: [{ group, message }] }],
  },
}));

export default tseslint.config(
  // Preserve the vendored upstream skill; it is not application source.
  { ignores: [".agents/skills/security-audit/**"] },
  {
    ignores: ["**/dist/**", "**/node_modules/**", "**/coverage/**", "**/.git/**"],
  },
  js.configs.recommended,
  ...tseslint.configs.recommendedTypeChecked,
  {
    languageOptions: {
      parserOptions: {
        project: [
          "./apps/*/tsconfig.test.json",
          "./packages/*/tsconfig.test.json",
          "./packages/shared/tsconfig.json",
          "./packages/tts-core/tsconfig.json",
        ],
        tsconfigRootDir: import.meta.dirname,
      },
    },
    rules: {
      // `async` intentionally satisfies promise-returning contracts (Fastify plugins,
      // AsyncIterator methods, provider mocks) even when the body has nothing to await.
      "@typescript-eslint/require-await": "off",
      // Settling with an upstream rejection reason as-is is deliberate propagation.
      "@typescript-eslint/prefer-promise-reject-errors": [
        "error",
        { allowThrowingAny: true, allowThrowingUnknown: true },
      ],
    },
  },
  {
    files: ["**/test/**/*.{ts,tsx}"],
    rules: {
      // `expect(mock.method)` is the Vitest idiom; the method is never invoked unbound.
      "@typescript-eslint/unbound-method": "off",
      // Tests inspect untyped JSON payloads directly.
      "@typescript-eslint/no-unsafe-argument": "off",
      "@typescript-eslint/no-unsafe-assignment": "off",
      "@typescript-eslint/no-unsafe-member-access": "off",
      // Testing Library and light-my-request infer generic return types from the assertion,
      // so these reports are false positives whose autofix would widen types to HTMLElement/any.
      "@typescript-eslint/no-unnecessary-type-assertion": "off",
    },
  },
  {
    files: ["**/*.{js,mjs,cjs}"],
    ...tseslint.configs.disableTypeChecked,
  },
  {
    files: ["apps/web/**/*.{ts,tsx}"],
    plugins: { "react-hooks": reactHooks },
    rules: {
      "react-hooks/rules-of-hooks": "error",
      "react-hooks/exhaustive-deps": "error",
    },
  },
  ...ARCHITECTURE_BOUNDARIES,
);
