import { useState } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { VoiceGroup } from "../../src/lib/voice-catalog.js";
import { VoiceList } from "../../src/workbench/VoiceList.js";

const GROUPS: VoiceGroup[] = [
  {
    label: "收藏",
    locale: null,
    voices: [
      {
        id: "en-US-JennyNeural",
        displayName: "Microsoft Jenny",
        locale: "en-US",
        gender: "Female",
      },
    ],
  },
  {
    label: "zh-CN",
    locale: "zh-CN",
    voices: [
      {
        id: "zh-CN-XiaoxiaoNeural",
        displayName: "Microsoft Xiaoxiao Online (Natural) - Chinese (Mainland)",
        locale: "zh-CN",
        gender: "Female",
      },
      { id: "zh-CN-YunxiNeural", displayName: "Microsoft Yunxi", locale: "zh-CN", gender: "Male" },
    ],
  },
];

function Harness({
  groups = GROUPS,
  disabled = false,
  onSelect,
}: {
  groups?: VoiceGroup[];
  disabled?: boolean;
  onSelect?: (id: string) => void;
}) {
  const [selected, setSelected] = useState("zh-CN-XiaoxiaoNeural");
  return (
    <VoiceList
      groups={groups}
      selectedVoiceId={selected}
      onSelect={(id) => {
        setSelected(id);
        onSelect?.(id);
      }}
      aria-label="选择声音 (3)"
      disabled={disabled}
      emptyMessage="没有匹配的声音"
    />
  );
}

afterEach(cleanup);

describe("VoiceList", () => {
  it("renders labelled groups of options with short names and marks the selection", () => {
    render(<Harness />);
    const list = screen.getByRole("listbox", { name: "选择声音 (3)" });
    const groups = within(list).getAllByRole("group");
    expect(groups.map((g) => g.getAttribute("aria-label"))).toEqual(["收藏", "zh-CN"]);
    // Locale groups show the region name in the interface language.
    expect(groups[1]!.textContent).toContain("中文（中国）");

    const selected = within(list).getByRole("option", { selected: true });
    expect(selected.textContent).toContain("Xiaoxiao");
    expect(selected.textContent).not.toContain("Microsoft");
    expect(selected.getAttribute("title")).toBe(
      "Microsoft Xiaoxiao Online (Natural) - Chinese (Mainland)",
    );
    expect(list.getAttribute("aria-activedescendant")).toBe(selected.id);
    expect(list.getAttribute("data-value")).toBe("zh-CN-XiaoxiaoNeural");
  });

  it("selects on click and moves focus into the list", async () => {
    const user = userEvent.setup();
    const onSelect = vi.fn();
    render(<Harness onSelect={onSelect} />);
    await user.click(screen.getByRole("option", { name: /Yunxi/ }));
    expect(onSelect).toHaveBeenCalledWith("zh-CN-YunxiNeural");
    expect(document.activeElement).toBe(screen.getByRole("listbox"));
  });

  it("moves the selection with arrow, Home and End keys across groups", async () => {
    const user = userEvent.setup();
    render(<Harness />);
    const list = screen.getByRole("listbox");
    list.focus();

    await user.keyboard("{ArrowDown}");
    expect(list.getAttribute("data-value")).toBe("zh-CN-YunxiNeural");
    await user.keyboard("{ArrowDown}");
    expect(list.getAttribute("data-value")).toBe("zh-CN-YunxiNeural"); // stays at the end
    await user.keyboard("{Home}");
    expect(list.getAttribute("data-value")).toBe("en-US-JennyNeural");
    await user.keyboard("{ArrowUp}");
    expect(list.getAttribute("data-value")).toBe("en-US-JennyNeural"); // stays at the start
    await user.keyboard("{End}");
    expect(list.getAttribute("data-value")).toBe("zh-CN-YunxiNeural");
    expect(list.getAttribute("aria-activedescendant")).toBe(
      screen.getByRole("option", { name: /Yunxi/ }).id,
    );
  });

  it("ignores input and leaves the tab order while disabled", async () => {
    const user = userEvent.setup();
    const onSelect = vi.fn();
    render(<Harness disabled onSelect={onSelect} />);
    const list = screen.getByRole("listbox");
    expect(list.getAttribute("aria-disabled")).toBe("true");
    expect(list.tabIndex).toBe(-1);
    await user.click(screen.getByRole("option", { name: /Yunxi/ }));
    list.focus();
    await user.keyboard("{ArrowDown}");
    expect(onSelect).not.toHaveBeenCalled();
  });

  it("shows the empty message instead of options when nothing matches", () => {
    render(<Harness groups={[]} />);
    const list = screen.getByRole("listbox");
    expect(within(list).queryAllByRole("option")).toEqual([]);
    expect(list.textContent).toBe("没有匹配的声音");
    expect(list.getAttribute("aria-disabled")).toBe("true");
    expect(list.getAttribute("aria-activedescendant")).toBeNull();
  });
});
