import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const read = (file: string) => readFileSync(resolve(__dirname, "../src/styles", file), "utf-8");
const tokens = read("tokens.css");
const css = ["tokens.css", "base.css", "controls.css", "workbench.css"].map(read).join("\n");

/** The declarations of the first rule matching `selector` exactly, e.g. ".btn-text". */
function ruleBody(selector: string): string {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = css.match(new RegExp(`(?:^|\\n)${escaped}\\s*\\{([^}]*)\\}`));
  expect(match, `missing rule for ${selector}`).not.toBeNull();
  return match![1]!;
}

function tokenValues(block: string): Record<string, string> {
  return Object.fromEntries(
    [...block.matchAll(/--([\w-]+):\s*(#[0-9a-f]{6})/gi)].map(
      ([, name, value]) => [name!, value!] as const,
    ),
  );
}

const darkBlock = tokens.match(
  /@media\s*\(\s*prefers-color-scheme:\s*dark\s*\)\s*\{\s*:root\s*\{([^}]*)\}/,
)?.[1];
const lightBlock = tokens.match(/^:root\s*\{([^}]*)\}/m)?.[1];

function luminance(hex: string): number {
  const channel = (offset: number) => {
    const c = parseInt(hex.slice(offset, offset + 2), 16) / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * channel(1) + 0.7152 * channel(3) + 0.0722 * channel(5);
}

function contrast(a: string, b: string): number {
  const [high, low] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (high! + 0.05) / (low! + 0.05);
}

describe("CSS accessibility and responsive layout contract", () => {
  it("defines focus ring tokens for the light and dark schemes", () => {
    expect(lightBlock).toContain("--focus-ring:");
    expect(lightBlock).toContain("--focus-ring-offset:");
    expect(darkBlock).toContain("--focus-ring:");
    expect(darkBlock).toContain("--focus-ring-offset:");
  });

  it("defines favorite state tokens for the light and dark schemes", () => {
    for (const block of [lightBlock, darkBlock]) {
      expect(block).toContain("--favorite-border:");
      expect(block).toContain("--favorite-text:");
      expect(block).toContain("--favorite-bg:");
    }
  });

  it.each([
    ["light", () => lightBlock],
    ["dark", () => darkBlock],
  ])("keeps text above WCAG AA contrast in the %s scheme", (_scheme, block) => {
    const t = tokenValues(block()!);
    const pairs: [string, string][] = [
      ["ink", "sheet"],
      ["ink", "paper"],
      ["ink-2", "sheet"],
      ["ink-2", "paper"],
      ["ink-3", "sheet"],
      ["ink-3", "paper"],
      ["ink-3", "selected"],
      ["accent-ink", "accent"],
      ["danger", "danger-soft"],
      ["favorite-text", "favorite-bg"],
    ];
    for (const [text, background] of pairs) {
      expect(t[text], `--${text}`).toBeDefined();
      expect(t[background], `--${background}`).toBeDefined();
      expect(
        contrast(t[text]!, t[background]!),
        `--${text} on --${background}`,
      ).toBeGreaterThanOrEqual(4.5);
    }
  });

  it("lets grid and flex children shrink to prevent narrow-viewport overflow", () => {
    expect(ruleBody(".workbench > *")).toMatch(/min-width:\s*0/);
    expect(ruleBody(".audio-player")).toMatch(/min-width:\s*0/);
    expect(ruleBody(".transport-body")).toMatch(/min-width:\s*0/);
  });

  it("gives every interactive control a visible keyboard focus treatment", () => {
    expect(css).toMatch(/(?:^|\n):focus-visible\s*\{[^}]*outline:\s*2px solid var\(--focus-ring\)/);
    for (const selector of [
      ".btn:focus-visible",
      ".btn-text:focus-visible",
      ".btn-favorite:focus-visible",
      ".btn-reset:focus-visible",
      ".btn-unlock:focus-visible",
      ".btn-download:focus-visible",
      ".control-input:focus-visible",
      ".control-select:focus-visible",
      ".segmented-option:focus-visible",
      ".voice-list:focus-visible",
      ".ui-audio-btn:focus-visible",
      ".auth-key-input:focus-visible",
      ".ui-checkbox-box:has(.ui-checkbox-input:focus-visible)",
      ".control-slider:focus-visible::-webkit-slider-thumb",
      ".sheet:has(.text-editor:focus-visible)",
    ]) {
      expect(css, selector).toContain(selector);
    }
  });

  it("enforces minimum touch target heights for interactive actions", () => {
    expect(ruleBody(".btn")).toMatch(/min-height:\s*40px/);
    expect(ruleBody(".btn-text")).toMatch(/min-height:\s*32px/);
    expect(ruleBody(".btn-favorite")).toMatch(/min-height:\s*32px/);
    expect(ruleBody(".btn-download")).toMatch(/min-height:\s*36px/);
    expect(ruleBody(".segmented-option")).toMatch(/min-height:\s*32px/);
    expect(ruleBody(".ui-audio-btn")).toMatch(/height:\s*32px/);
  });

  it("supports prefers-reduced-motion to suppress animations and transitions", () => {
    expect(css).toMatch(
      /@media\s*\(\s*prefers-reduced-motion:\s*reduce\s*\)\s*\{[^}]*transition-duration:\s*0\.01ms/s,
    );
    expect(css).toMatch(
      /@media\s*\(\s*prefers-reduced-motion:\s*reduce\s*\)\s*\{[^}]*animation-duration:\s*0\.01ms/s,
    );
  });

  it("stacks to a single column below 768px with a pinned transport bar", () => {
    const mobile = css.match(/@media\s*\(\s*max-width:\s*767px\s*\)\s*\{([\s\S]*?)\n\}/)?.[1];
    expect(mobile).toBeDefined();
    expect(mobile).toMatch(/\.workbench\s*\{[^}]*grid-template-columns:\s*1fr/);
    expect(mobile).toMatch(/\.transport\s*\{[^}]*position:\s*sticky/);
    expect(mobile).toContain(".action-buttons");
    expect(mobile).toContain(".audio-player");
  });
});
