import React, { useState } from "react";
import { describe, it, expect, afterEach } from "vitest";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Slider } from "../../src/ui/Slider.js";

describe("UI Primitive: Slider", () => {
  afterEach(() => {
    cleanup();
  });

  function TestSliderWrapper({
    initial = 1.0,
    disabled = false,
  }: {
    initial?: number;
    disabled?: boolean;
  }) {
    const [val, setVal] = useState<number>(initial);
    return (
      <Slider
        id="test-slider"
        label="语速 (Speed)"
        value={val}
        formattedValue={`${val.toFixed(2)}x`}
        min={0.5}
        max={2.0}
        step={0.05}
        onChange={setVal}
        onReset={() => setVal(1.0)}
        isDefault={val === 1.0}
        resetAriaLabel="重置语速"
        disabled={disabled}
      />
    );
  }

  it("renders label, formatted value, reset button, and range input", () => {
    render(<TestSliderWrapper initial={1.0} />);

    expect(screen.getByText("语速 (Speed)")).toBeDefined();
    expect(screen.getByText("1.00x")).toBeDefined();

    const slider = screen.getByLabelText("语速 (Speed)") as HTMLInputElement;
    expect(slider.type).toBe("range");
    expect(slider.value).toBe("1");
    expect(slider.min).toBe("0.5");
    expect(slider.max).toBe("2");

    const resetBtn = screen.getByRole("button", { name: "重置语速" }) as HTMLButtonElement;
    expect(resetBtn.disabled).toBe(true);
  });

  it("computes progress percentage style and updates on change", () => {
    render(<TestSliderWrapper initial={1.25} />);

    const slider = screen.getByLabelText("语速 (Speed)") as HTMLInputElement;
    // (1.25 - 0.5) / (2.0 - 0.5) = 0.75 / 1.5 = 50%
    expect(slider.style.getPropertyValue("--slider-progress")).toBe("50%");
  });

  it("enables reset button when value is changed and resets on click", async () => {
    const user = userEvent.setup();
    render(<TestSliderWrapper initial={1.0} />);

    const slider = screen.getByLabelText("语速 (Speed)") as HTMLInputElement;
    const resetBtn = screen.getByRole("button", { name: "重置语速" }) as HTMLButtonElement;

    expect(resetBtn.disabled).toBe(true);

    fireEvent.change(slider, { target: { value: "1.5" } });
    expect(screen.getByText("1.50x")).toBeDefined();
    expect(resetBtn.disabled).toBe(false);

    await user.click(resetBtn);
    expect(screen.getByText("1.00x")).toBeDefined();
    expect(slider.value).toBe("1");
    expect(resetBtn.disabled).toBe(true);
  });

  it("disables range input and reset button when disabled prop is set", () => {
    render(<TestSliderWrapper initial={1.5} disabled={true} />);

    const slider = screen.getByLabelText("语速 (Speed)") as HTMLInputElement;
    const resetBtn = screen.getByRole("button", { name: "重置语速" }) as HTMLButtonElement;

    expect(slider.disabled).toBe(true);
    expect(resetBtn.disabled).toBe(true);
  });
});
