import assert from "node:assert/strict";
import process from "node:process";

// Check names and values without printing potentially sensitive environment contents.
assert.ok(
  !Object.entries(process.env).some(([name, value]) =>
    /API_KEY|GHCR|TOKEN/iu.test(`${name}=${value}`),
  ),
  "Unexpected credential material in image environment",
);
