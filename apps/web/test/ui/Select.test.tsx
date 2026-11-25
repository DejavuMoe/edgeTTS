import { useState } from "react";
import { describe, it, expect, afterEach, vi } from "vitest";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import {
  Select,
  findTypeaheadIndex,
  type SelectOption,
  type SelectGroup,
} from "../../src/ui/Select.js";

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

  describe("type-ahead", () => {
    const activeValue = (trigger: HTMLElement): string | undefined =>
      trigger.getAttribute("aria-activedescendant")?.replace(/^.*-opt-/, "");

    it("opens the menu on a letter and moves to the first option that starts with it", async () => {
      const user = userEvent.setup();
      render(<TestSelectWrapper />);
      const trigger = screen.getByRole("combobox", { name: "Test Select Label" });
      trigger.focus();

      await user.keyboard("g");
      expect(trigger.getAttribute("aria-expanded")).toBe("true");
      expect(activeValue(trigger)).toBe("g1");

      await user.keyboard("{Enter}");
      expect(trigger.getAttribute("data-value")).toBe("g1");
    });

    it("matches secondary labels and lets Space join a query being typed", async () => {
      const user = userEvent.setup();
      render(<TestSelectWrapper />);
      const trigger = screen.getByRole("combobox", { name: "Test Select Label" });
      trigger.focus();

      await user.keyboard("sub");
      expect(activeValue(trigger)).toBe("g1");
      await user.keyboard("{Escape}");

      // "option t" reaches Option Two; the space continues the query instead of selecting.
      await user.keyboard("option t");
      expect(trigger.getAttribute("aria-expanded")).toBe("true");
      expect(activeValue(trigger)).toBe("opt2");
    });

    it("cycles through options that start with a repeated letter, skipping disabled ones", async () => {
      const user = userEvent.setup();
      render(<TestSelectWrapper />);
      const trigger = screen.getByRole("combobox", { name: "Test Select Label" });
      trigger.focus();

      await user.keyboard("o");
      expect(activeValue(trigger)).toBe("opt2");
      // Option Three is disabled, so the next "o" wraps around to Option One.
      await user.keyboard("o");
      expect(activeValue(trigger)).toBe("opt1");
    });

    it("starts a new query after a pause", () => {
      vi.useFakeTimers();
      try {
        render(<TestSelectWrapper />);
        const trigger = screen.getByRole("combobox", { name: "Test Select Label" });
        fireEvent.keyDown(trigger, { key: "g" });
        expect(activeValue(trigger)).toBe("g1");
        vi.advanceTimersByTime(600);
        // A fresh "o", not "go", which would match nothing.
        fireEvent.keyDown(trigger, { key: "o" });
        expect(activeValue(trigger)).toBe("opt1");
      } finally {
        vi.useRealTimers();
      }
    });

    it("leaves shortcuts with modifier keys alone", () => {
      render(<TestSelectWrapper />);
      const trigger = screen.getByRole("combobox", { name: "Test Select Label" });
      fireEvent.keyDown(trigger, { key: "g", ctrlKey: true });
      fireEvent.keyDown(trigger, { key: "g", metaKey: true });
      fireEvent.keyDown(trigger, { key: "g", altKey: true });
      expect(trigger.getAttribute("aria-expanded")).toBe("false");
    });

    it("finds matches case- and width-insensitively and returns -1 when nothing matches", () => {
      const options: SelectOption[] = [
        { value: "zh-CN", label: "zh-CN (6)", secondaryLabel: "中文（中国）" },
        { value: "ja-JP", label: "ja-JP (2)", secondaryLabel: "日本語 (日本)" },
        { value: "zh-HK", label: "zh-HK (3)", secondaryLabel: "中文（香港）" },
      ];
      expect(findTypeaheadIndex(options, "ja", 0)).toBe(1);
      expect(findTypeaheadIndex(options, "zh", 0)).toBe(0);
      expect(findTypeaheadIndex(options, "z", 0)).toBe(2);
      // Queries arrive normalized; option labels are normalized here, so "（" matches "(".
      expect(findTypeaheadIndex(options, "中文(香", 0)).toBe(2);
      expect(findTypeaheadIndex(options, "xx", 0)).toBe(-1);
      expect(findTypeaheadIndex([], "a", -1)).toBe(-1);
    });
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
