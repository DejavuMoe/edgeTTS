import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { I18nProvider, LANGUAGE_OPTIONS, translate, UI_LOCALE_KEY } from "../../src/i18n.js";
import { REPOSITORY_URL, WorkbenchHeader } from "../../src/workbench/WorkbenchHeader.js";

beforeEach(() => {
  localStorage.clear();
});

afterEach(() => {
  cleanup();
  localStorage.clear();
});

describe("WorkbenchHeader", () => {
  it("links to the GitHub repository in a new tab without exposing the workbench", () => {
    render(
      <I18nProvider>
        <WorkbenchHeader apiStatus="healthy" />
      </I18nProvider>,
    );

    const link = screen.getByRole("link", { name: "在 GitHub 查看源代码" });
    expect(REPOSITORY_URL).toBe("https://github.com/DejavuMoe/edgeTTS");
    expect(link.getAttribute("href")).toBe(REPOSITORY_URL);
    expect(link.getAttribute("target")).toBe("_blank");
    expect(link.getAttribute("rel")).toBe("noopener noreferrer");
    expect(link.querySelector("svg")?.getAttribute("aria-hidden")).toBe("true");
  });

  it.each(LANGUAGE_OPTIONS)("names the repository link in $label", ({ value }) => {
    localStorage.setItem(UI_LOCALE_KEY, value);
    render(
      <I18nProvider>
        <WorkbenchHeader apiStatus="healthy" />
      </I18nProvider>,
    );

    const name = translate("在 GitHub 查看源代码", value);
    const link = screen.getByRole("link", { name });
    expect(link.getAttribute("title")).toBe(name);
  });
});
