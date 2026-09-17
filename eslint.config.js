import js from "@eslint/js";
import tseslint from "typescript-eslint";

export default tseslint.config(
  // Preserve the vendored upstream skill; it is not application source.
  { ignores: [".pi/skills/security-audit/**"] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    ignores: ["**/dist/**", "**/node_modules/**", "**/.git/**"],
  },
);
