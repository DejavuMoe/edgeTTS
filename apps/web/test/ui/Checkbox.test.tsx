import React, { useState } from "react";
import { describe, it, expect, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Checkbox } from "../../src/ui/Checkbox.js";

describe("UI Primitive: Checkbox", () => {
  afterEach(() => {
    cleanup();
  });

  function TestCheckboxWrapper({
    initial = false,
    disabled = false,
  }: {
    initial?: boolean;
    disabled?: boolean;
  }) {
    const [checked, setChecked] = useState<boolean>(initial);
    return (
      <Checkbox
        id="test-checkbox"
        checked={checked}
        onChange={setChecked}
        label="只看收藏"
        disabled={disabled}
      />
    );
  }

  it("renders accessible checkbox with label and styled check container", () => {
    render(<TestCheckboxWrapper initial={false} />);

    const checkbox = screen.getByRole("checkbox", { name: "只看收藏" }) as HTMLInputElement;
    expect(checkbox).toBeDefined();
    expect(checkbox.checked).toBe(false);
    expect(checkbox.disabled).toBe(false);

    const box = document.querySelector(".ui-checkbox-box");
    expect(box).not.toBeNull();
    expect(box?.classList.contains("is-checked")).toBe(false);
  });

  it("toggles state on click and updates visual check styling", async () => {
    const user = userEvent.setup();
    render(<TestCheckboxWrapper initial={false} />);

    const checkbox = screen.getByRole("checkbox", { name: "只看收藏" }) as HTMLInputElement;
    const box = document.querySelector(".ui-checkbox-box");

    await user.click(checkbox);
    expect(checkbox.checked).toBe(true);
    expect(box?.classList.contains("is-checked")).toBe(true);

    await user.click(checkbox);
    expect(checkbox.checked).toBe(false);
    expect(box?.classList.contains("is-checked")).toBe(false);
  });

  it("toggles state via keyboard Space key", async () => {
    const user = userEvent.setup();
    render(<TestCheckboxWrapper initial={false} />);

    const checkbox = screen.getByRole("checkbox", { name: "只看收藏" }) as HTMLInputElement;
    checkbox.focus();

    await user.keyboard(" ");
    expect(checkbox.checked).toBe(true);

    await user.keyboard(" ");
    expect(checkbox.checked).toBe(false);
  });

  it("prevents interaction when disabled", async () => {
    const user = userEvent.setup();
    render(<TestCheckboxWrapper initial={false} disabled={true} />);

    const checkbox = screen.getByRole("checkbox", { name: "只看收藏" }) as HTMLInputElement;
    expect(checkbox.disabled).toBe(true);

    await user.click(checkbox);
    expect(checkbox.checked).toBe(false);
  });
});
