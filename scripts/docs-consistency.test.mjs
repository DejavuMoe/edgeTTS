// Keeps the documentation truthful: translations reference the same contract identifiers,
// relative links and anchors resolve, release image tags match the package version, and every
// environment variable the server reads is documented.
import assert from "node:assert/strict";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath, URL } from "node:url";

const root = fileURLToPath(new URL("../", import.meta.url));
const read = (file) => readFileSync(path.join(root, file), "utf8");

const TRANSLATIONS = [
  "README",
  "docs/api",
  "docs/configuration",
  "docs/deployment",
  "docs/reverse-proxy",
];
const LANGUAGES = ["", ".zh-CN", ".ja"];

// Walk the tree rather than asking git: Linux build mirrors intentionally have no .git.
const IGNORED_DIRECTORIES = new Set([".git", ".agents", "node_modules", "dist", "coverage"]);
function findMarkdown(directory = "") {
  return readdirSync(path.join(root, directory), { withFileTypes: true }).flatMap((entry) => {
    const relative = path.posix.join(directory, entry.name);
    if (entry.isDirectory())
      return IGNORED_DIRECTORIES.has(entry.name) ? [] : findMarkdown(relative);
    return entry.name.endsWith(".md") ? [relative] : [];
  });
}
const markdownFiles = findMarkdown().sort();

/** Prose without fenced code, where translated text and identifiers live. */
function prose(markdown) {
  return markdown.replace(/```[\s\S]*?```/g, "");
}

/** Identifiers that are part of the product contract: env vars, error codes, HTTP paths. */
function contractTokens(markdown) {
  const text = prose(markdown);
  const tokens = new Set();
  for (const [, token] of text.matchAll(/`([A-Z][A-Z0-9_]{2,})`/g)) tokens.add(token);
  for (const [, , route] of text.matchAll(/`((?:GET|POST) )?(\/(?:api|v1|health)[^`\s]*)`/g)) {
    tokens.add(route);
  }
  return tokens;
}

/** GitHub-style heading anchors, including -1, -2 suffixes for duplicates. */
function headingAnchors(markdown) {
  const anchors = new Set();
  const seen = new Map();
  for (const [, heading] of prose(markdown).matchAll(/^#{1,6} (.+)$/gm)) {
    const base = heading
      .trim()
      .toLowerCase()
      .replace(/[^\p{L}\p{M}\p{N}\p{Pc}\- ]/gu, "")
      .replace(/ /g, "-");
    const count = seen.get(base) ?? 0;
    seen.set(base, count + 1);
    anchors.add(count === 0 ? base : `${base}-${count}`);
  }
  return anchors;
}

describe("translations", () => {
  for (const base of TRANSLATIONS) {
    it(`${base} references the same contract identifiers in every language`, () => {
      const [reference, ...others] = LANGUAGES.map((lang) => `${base}${lang}.md`);
      const expected = [...contractTokens(read(reference))].sort();
      for (const file of others) {
        assert.deepEqual(
          [...contractTokens(read(file))].sort(),
          expected,
          `${file} vs ${reference}`,
        );
      }
    });
  }
});

describe("links", () => {
  for (const file of markdownFiles) {
    it(`${file} has resolvable relative links and anchors`, () => {
      const problems = [];
      for (const [, target] of prose(read(file)).matchAll(/\]\(([^)\s]+)\)/g)) {
        if (/^(https?:|mailto:)/.test(target)) continue;
        const [linkPath, anchor] = target.split("#");
        const resolved = linkPath ? path.join(path.dirname(file), linkPath) : file;
        if (!existsSync(path.join(root, resolved))) {
          problems.push(`missing file: ${target}`);
        } else if (anchor && resolved.endsWith(".md")) {
          if (!headingAnchors(read(resolved)).has(decodeURIComponent(anchor))) {
            problems.push(`missing anchor: ${target}`);
          }
        }
      }
      assert.deepEqual(problems, []);
    });
  }
});

describe("versions", () => {
  it("documents the current release image tag", () => {
    const { version } = JSON.parse(read("package.json"));
    const stale = [];
    for (const file of markdownFiles) {
      for (const [tag, tagVersion] of read(file).matchAll(
        /ghcr\.io\/dejavumoe\/edgetts:(\d+\.\d+\.\d+)/g,
      )) {
        if (tagVersion !== version) stale.push(`${file}: ${tag}`);
      }
    }
    assert.deepEqual(stale, [], `expected ghcr.io/dejavumoe/edgetts:${version}`);
  });
});

describe("configuration", () => {
  it("documents every environment variable the server reads", () => {
    const sourceDir = path.join(root, "apps/server/src");
    const names = new Set();
    for (const entry of readdirSync(sourceDir, { recursive: true })) {
      if (!entry.endsWith(".ts")) continue;
      const source = readFileSync(path.join(sourceDir, entry), "utf8");
      for (const [, name] of source.matchAll(/env\["([A-Z][A-Z0-9_]+)"\]/g)) names.add(name);
      for (const [, name] of source.matchAll(/optionalInteger\("([A-Z][A-Z0-9_]+)"/g))
        names.add(name);
    }
    assert.ok(names.size >= 10, `expected to discover server variables, found ${names.size}`);

    const documented = contractTokens(read("docs/configuration.md"));
    assert.deepEqual([...names].filter((name) => !documented.has(name)).sort(), []);
  });
});
