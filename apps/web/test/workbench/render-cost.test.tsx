import { useCallback, useState } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, render, renderHook, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { VoiceGroup } from "../../src/lib/voice-catalog.js";
import { shortVoiceName } from "../../src/lib/voice-names.js";
import { useWorkbenchConnection } from "../../src/workbench/useWorkbenchConnection.js";
import { VoiceList } from "../../src/workbench/VoiceList.js";

// Every voice row renders its short name once, so counting calls counts row renders.
vi.mock("../../src/lib/voice-names.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../src/lib/voice-names.js")>();
  return { ...actual, shortVoiceName: vi.fn(actual.shortVoiceName) };
});

const VOICES = Array.from({ length: 40 }, (_, index) => ({
  id: `zh-CN-Voice${index}Neural`,
  displayName: `Microsoft Voice${index}`,
  locale: "zh-CN",
  gender: index % 2 ? "Male" : "Female",
}));
const GROUPS: VoiceGroup[] = [{ label: "zh-CN", locale: "zh-CN", voices: VOICES }];

/** Stands in for the workbench: unrelated state (the draft) changes beside a stable list. */
function Workbench() {
  const [draft, setDraft] = useState("");
  const [selected, setSelected] = useState(VOICES[0]!.id);
  const select = useCallback((voiceId: string) => setSelected(voiceId), []);
  return (
    <>
      <textarea aria-label="draft" value={draft} onChange={(e) => setDraft(e.target.value)} />
      <VoiceList
        groups={GROUPS}
        selectedVoiceId={selected}
        onSelect={select}
        aria-label="选择声音 (40)"
        disabled={false}
        emptyMessage="没有匹配的声音"
      />
    </>
  );
}

const rowRenders = () => vi.mocked(shortVoiceName).mock.calls.length;

describe("voice list render cost", () => {
  beforeEach(() => {
    vi.mocked(shortVoiceName).mockClear();
  });

  afterEach(() => {
    cleanup();
  });

  it("does not re-render any voice row while the user types elsewhere", async () => {
    const user = userEvent.setup();
    render(<Workbench />);
    expect(rowRenders()).toBe(VOICES.length);

    await user.type(screen.getByLabelText("draft"), "你好，世界");

    expect(rowRenders()).toBe(VOICES.length);
  });

  it("re-renders only the two rows a selection change touches", async () => {
    const user = userEvent.setup();
    render(<Workbench />);
    vi.mocked(shortVoiceName).mockClear();

    await user.click(screen.getByRole("option", { name: /Voice7/ }));

    expect(screen.getByRole("option", { name: /Voice7/ }).getAttribute("aria-selected")).toBe(
      "true",
    );
    expect(rowRenders()).toBe(2);
  });
});

describe("useWorkbenchConnection", () => {
  beforeEach(() => {
    globalThis.fetch = vi.fn<typeof fetch>(async (input) => {
      const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
      const body = url.endsWith("/api/health") ? { status: "ok" } : { voices: VOICES };
      return new Response(JSON.stringify(body), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("keeps selectVoice stable so the memoized voice list can skip renders", async () => {
    const { result } = renderHook(() => useWorkbenchConnection(""));
    const initial = result.current.selectVoice;
    await waitFor(() => expect(result.current.voices).toHaveLength(VOICES.length));

    act(() => result.current.selectVoice(VOICES[3]!.id));

    expect(result.current.selectedVoiceId).toBe(VOICES[3]!.id);
    expect(result.current.selectVoice).toBe(initial);
  });
});
