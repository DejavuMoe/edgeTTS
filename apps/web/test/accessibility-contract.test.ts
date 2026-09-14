import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

describe("Phase 25: CSS Accessibility & Responsive Layout Contract", () => {
  const cssPath = resolve(__dirname, "../src/App.css");
  const css = readFileSync(cssPath, "utf-8");

  it("defines focus ring custom properties in root and dark color schemes", () => {
    expect(css).toContain("--focus-ring:");
    expect(css).toContain("--focus-ring-offset:");

    // Both root and dark theme provide focus tokens
    const rootMatches = css.match(/:root\s*\{[^}]*--focus-ring:[^}]*\}/s);
    expect(rootMatches).not.toBeNull();

    const darkMatches = css.match(
      /@media\s*\(\s*prefers-color-scheme:\s*dark\s*\)\s*\{[^}]*--focus-ring:[^}]*\}/s,
    );
    expect(darkMatches).not.toBeNull();
  });

  it("defines favorite state color tokens for light and dark schemes", () => {
    expect(css).toContain("--favorite-border:");
    expect(css).toContain("--favorite-text:");
    expect(css).toContain("--favorite-bg:");
  });

  it("applies min-width: 0 to grid and flex children to prevent narrow-viewport overflow", () => {
    // Grid children must have min-width: 0 to override auto min-width
    expect(css).toMatch(/\.workbench-main\s*>\s*\*\s*\{[^}]*min-width:\s*0/);

    // Audio player must not enforce a rigid min-width
    expect(css).toMatch(/\.audio-player\s*\{[^}]*min-width:\s*0/);
  });

  it("provides focus-visible styling for interactive form controls and actions", () => {
    // Form controls and buttons must have visible keyboard focus treatment
    expect(css).toContain(".btn:focus-visible");
    expect(css).toContain(".btn-editor-action:focus-visible");
    expect(css).toContain(".btn-favorite:focus-visible");
    expect(css).toContain(".btn-reset:focus-visible");
    expect(css).toContain(".btn-reset-params:focus-visible");
    expect(css).toContain(".btn-unlock:focus-visible");
    expect(css).toContain(".btn-download:focus-visible");
    expect(css).toContain(".text-editor:focus-visible");
    expect(css).toContain(".control-input:focus-visible");
    expect(css).toContain(".control-select:focus-visible");
    expect(css).toContain(".control-slider:focus-visible");
    expect(css).toContain('.favorite-checkbox-label input[type="checkbox"]:focus-visible');
    expect(css).toContain(".auth-key-input:focus-visible");
  });

  it("enforces compact touch target minimum heights for interactive actions", () => {
    expect(css).toMatch(/\.btn-editor-action\s*\{[^}]*min-height:\s*32px/);
    expect(css).toMatch(/\.btn-favorite\s*\{[^}]*min-height:\s*32px/);
    expect(css).toMatch(/\.btn-download\s*\{[^}]*min-height:\s*36px/);
    expect(css).toMatch(/\.btn-reset-params\s*\{[^}]*min-height:\s*32px/);
  });

  it("supports prefers-reduced-motion to suppress animations and transitions", () => {
    expect(css).toContain("@media (prefers-reduced-motion: reduce)");
    expect(css).toMatch(
      /@media\s*\(\s*prefers-reduced-motion:\s*reduce\s*\)\s*\{[^}]*transition-duration:\s*0\.01ms/s,
    );
  });

  it("defines 767px mobile media query for single-column responsive stacking", () => {
    expect(css).toContain("@media (max-width: 767px)");
    const mobileQuery = css.match(/@media\s*\(\s*max-width:\s*767px\s*\)\s*\{([\s\S]*?)\n\}/);
    expect(mobileQuery).not.toBeNull();
    const mobileContent = mobileQuery![1];

    expect(mobileContent).toContain("grid-template-columns: 1fr");
    expect(mobileContent).toContain(".action-buttons");
    expect(mobileContent).toContain(".audio-player");
  });
});
