import { useState } from "react";
import { describe, it, expect, afterEach } from "vitest";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Select, type SelectOption, type SelectGroup } from "../../src/ui/Select.js";

describe("UI Primitive: Select", () => {
  afterEach(() => {
    cleanup();
  });

  const sampleOptions: SelectOption[] = [
    { value: "opt1", label: "Option One" },
    { value: "opt2", label: "Option Two", secondaryLabel: "Secondary 2" },
    { value: "opt3", label: "Option Three", disabled: true },
  ];

  const sampleGroups: SelectGroup[] = [
    {
      label: "Group A",
      options: [
        { value: "g1", label: "Group Item 1", secondaryLabel: "Sub A1" },
        { value: "g2", label: "Group Item 2" },
      ],
    },
  ];

  function TestSelectWrapper({
    initialValue = "opt1",
    disabled = false,
  }: {
    initialValue?: string;
    disabled?: boolean;
  }) {
    const [val, setVal] = useState<string>(initialValue);
    return (
      <Select
        id="test-select"
        value={val}
        onChange={setVal}
        options={sampleOptions}
        groups={sampleGroups}
        aria-label="Test Select Label"
        disabled={disabled}
      />
    );
  }

  it("renders trigger button with current value and combobox ARIA attributes", () => {
    render(<TestSelectWrapper />);

    const trigger = screen.getByRole("combobox", { name: "Test Select Label" });
    expect(trigger).toBeDefined();
    expect(trigger.getAttribute("aria-expanded")).toBe("false");
    expect(trigger.getAttribute("aria-haspopup")).toBe("listbox");
    expect(trigger.getAttribute("data-value")).toBe("opt1");
    expect(trigger.textContent).toContain("Option One");
  });

  it("opens portal listbox on trigger click and renders options and groups", async () => {
    const user = userEvent.setup();
    render(<TestSelectWrapper />);

    const trigger = screen.getByRole("combobox", { name: "Test Select Label" });
    await user.click(trigger);

    expect(trigger.getAttribute("aria-expanded")).toBe("true");

    const listbox = screen.getByRole("listbox");
    expect(listbox).toBeDefined();

    const options = screen.getAllByRole("option");
    // 3 standalone + 2 in group = 5 total
    expect(options.length).toBe(5);

    // Option 2 has secondary label
    expect(options[1]?.textContent).toContain("Option Two");
    expect(options[1]?.textContent).toContain("Secondary 2");

    // Group header is rendered
    expect(screen.getByText("Group A")).toBeDefined();
  });

  it("selects an option on click and updates trigger value", async () => {
    const user = userEvent.setup();
    render(<TestSelectWrapper />);

    const trigger = screen.getByRole("combobox", { name: "Test Select Label" });
    await user.click(trigger);

    const option2 = screen.getByRole("option", { name: /Option Two/i });
    await user.click(option2);

    expect(trigger.getAttribute("aria-expanded")).toBe("false");
    expect(trigger.getAttribute("data-value")).toBe("opt2");
    expect(trigger.textContent).toContain("Option Two");
  });

  it("does not select disabled options", async () => {
    const user = userEvent.setup();
    render(<TestSelectWrapper />);

    const trigger = screen.getByRole("combobox", { name: "Test Select Label" });
    await user.click(trigger);

    const disabledOption = screen.getByRole("option", { name: /Option Three/i });
    expect(disabledOption.getAttribute("aria-disabled")).toBe("true");

    await user.click(disabledOption);

    // Dropdown stays open or value remains opt1
    expect(trigger.getAttribute("data-value")).toBe("opt1");
  });

  it("navigates options via keyboard ArrowDown, ArrowUp, Enter, and Escape", async () => {
    const user = userEvent.setup();
    render(<TestSelectWrapper />);

    const trigger = screen.getByRole("combobox", { name: "Test Select Label" });
    trigger.focus();

    // ArrowDown opens dropdown
    await user.keyboard("{ArrowDown}");
    expect(trigger.getAttribute("aria-expanded")).toBe("true");

    // Navigate to next option (Option Two)
    await user.keyboard("{ArrowDown}");
    // Press Enter to select
    await user.keyboard("{Enter}");

    expect(trigger.getAttribute("aria-expanded")).toBe("false");
    expect(trigger.getAttribute("data-value")).toBe("opt2");

    // Open again and close with Escape
    await user.click(trigger);
    expect(trigger.getAttribute("aria-expanded")).toBe("true");
    await user.keyboard("{Escape}");
    expect(trigger.getAttribute("aria-expanded")).toBe("false");
  });

  it("closes listbox on outside click", async () => {
    const user = userEvent.setup();
    render(
      <div>
        <div data-testid="outside-area">Outside</div>
        <TestSelectWrapper />
      </div>,
    );

    const trigger = screen.getByRole("combobox", { name: "Test Select Label" });
    await user.click(trigger);
    expect(trigger.getAttribute("aria-expanded")).toBe("true");

    // Click outside
    fireEvent.mouseDown(screen.getByTestId("outside-area"));
    expect(trigger.getAttribute("aria-expanded")).toBe("false");
  });

  it("does not open when disabled", async () => {
    const user = userEvent.setup();
    render(<TestSelectWrapper disabled={true} />);

    const trigger = screen.getByRole("combobox", { name: "Test Select Label" });
    expect(trigger.getAttribute("disabled")).not.toBeNull();

    await user.click(trigger);
    expect(trigger.getAttribute("aria-expanded")).toBe("false");
    expect(screen.queryByRole("listbox")).toBeNull();
  });
});
