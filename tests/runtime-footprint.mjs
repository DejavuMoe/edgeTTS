import assert from "node:assert/strict";
import { readdirSync, lstatSync } from "node:fs";
import { log } from "node:console";
// Count allocated file blocks without requiring du or a shell in production.
function rootfsBytes(directory) {
  let bytes = 0;
  for (const name of readdirSync(directory || "/")) {
    const entry = directory + "/" + name;
    if (["/proc", "/sys", "/dev"].includes(entry)) continue;
    if (entry.startsWith("/app/")) {
      assert.ok(!/\.(?:ts|mts|cts)$/u.test(name), "TypeScript source shipped: " + entry);
      assert.notEqual(name, ".github", "development metadata shipped: " + entry);
    }
    const stat = lstatSync(entry);
    bytes += stat.blocks * 512;
    if (stat.isDirectory()) bytes += rootfsBytes(entry);
  }
  return bytes;
}
const footprint = rootfsBytes("");
log("Root filesystem allocated bytes:", footprint);
assert.ok(footprint <= 160 * 1024 * 1024, "runtime exceeds 160 MiB budget");
