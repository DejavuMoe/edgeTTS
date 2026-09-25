import { useState } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { SegmentedControl } from "../../src/ui/SegmentedControl.js";

const OPTIONS = [
  { value: "standard", label: "Standard", detail: "48 kbps" },
  { value: "high", label: "High", detail: "96 kbps" },
] as const;

function Harness({ onChange }: { onChange?: (value: string) => void }) {
  const [value, setValue] = useState<"standard" | "high">("standard");
  return (
    <SegmentedControl
      aria-label="Quality"
      value={value}
      options={OPTIONS}
      onChange={(next) => {
        setValue(next);
        onChange?.(next);
      }}
    />
  );
}

afterEach(cleanup);

describe("SegmentedControl", () => {
  it("exposes a labelled radio group with the checked option", () => {
    render(<Harness />);
    expect(screen.getByRole("radiogroup", { name: "Quality" })).toBeDefined();
    expect(screen.getByRole("radio", { name: /Standard/ }).getAttribute("aria-checked")).toBe(
      "true",
    );
    expect(screen.getByRole("radio", { name: /High/ }).getAttribute("aria-checked")).toBe("false");
    expect(screen.getByRole("radio", { name: /High/ }).textContent).toContain("96 kbps");
  });

  it("selects on click", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<Harness onChange={onChange} />);
    await user.click(screen.getByRole("radio", { name: /High/ }));
    expect(onChange).toHaveBeenCalledWith("high");
    expect(screen.getByRole("radio", { name: /High/ }).getAttribute("aria-checked")).toBe("true");
  });

  it("has a single tab stop and moves the selection with arrow keys", async () => {
    const user = userEvent.setup();
    render(<Harness />);
    await user.tab();
    expect(document.activeElement).toBe(screen.getByRole("radio", { name: /Standard/ }));
    await user.keyboard("{ArrowRight}");
    const high = screen.getByRole("radio", { name: /High/ });
    expect(document.activeElement).toBe(high);
    expect(high.getAttribute("aria-checked")).toBe("true");
    await user.keyboard("{ArrowRight}");
    expect(screen.getByRole("radio", { name: /Standard/ }).getAttribute("aria-checked")).toBe(
      "true",
    );
    await user.tab();
    expect(document.activeElement).toBe(document.body);
  });

  it("ignores input while disabled", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(
      <SegmentedControl
        aria-label="Quality"
        value="standard"
        options={OPTIONS}
        onChange={onChange}
        disabled
      />,
    );
    await user.click(screen.getByRole("radio", { name: /High/ }));
    expect(onChange).not.toHaveBeenCalled();
  });
});
