import { afterEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, render, waitFor } from "@testing-library/react";
import { cachedVoiceAvatar, voiceAvatarKey } from "../../src/lib/voice-avatar.js";
import { VoiceAvatar } from "../../src/workbench/VoiceAvatar.js";

const NANAMI = {
  id: "ja-JP-NanamiNeural",
  displayName: "Microsoft Nanami",
  locale: "ja-JP",
  gender: "Female",
};

class ManualIntersectionObserver {
  static instances: ManualIntersectionObserver[] = [];
  readonly observed: Element[] = [];
  disconnected = false;

  constructor(private readonly callback: IntersectionObserverCallback) {
    ManualIntersectionObserver.instances.push(this);
  }

  observe(element: Element): void {
    this.observed.push(element);
  }

  disconnect(): void {
    this.disconnected = true;
  }

  enter(): void {
    const entries = this.observed.map((target) => ({ target, isIntersecting: true }));
    this.callback(entries as unknown as IntersectionObserverEntry[], this as never);
  }
}

describe("VoiceAvatar", () => {
  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
    ManualIntersectionObserver.instances = [];
  });

  it("keeps the monogram until the avatar scrolls into view, then shows the portrait", async () => {
    vi.stubGlobal("IntersectionObserver", ManualIntersectionObserver);
    const { container } = render(<VoiceAvatar voice={NANAMI} />);
    const frame = container.querySelector(".voice-avatar");

    // Off screen: no portrait is drawn, however long we wait.
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(cachedVoiceAvatar(voiceAvatarKey(NANAMI))).toBeNull();
    expect(frame?.textContent).toBe("N");
    expect(frame?.hasAttribute("data-portrait")).toBe(false);

    const [observer] = ManualIntersectionObserver.instances;
    expect(observer?.observed).toEqual([frame]);
    act(() => observer?.enter());

    await waitFor(() => expect(frame?.querySelector("img")).not.toBeNull());
    expect(frame?.hasAttribute("data-portrait")).toBe(true);
    expect(frame?.querySelector("img")?.getAttribute("src")).toMatch(/^data:image\/svg\+xml/);
    expect(observer?.disconnected).toBe(true);
  });

  it("draws the portrait without waiting where IntersectionObserver is missing", async () => {
    vi.stubGlobal("IntersectionObserver", undefined);
    const { container } = render(
      <VoiceAvatar
        voice={{ id: "ko-KR-SunHiNeural", displayName: "SunHi", locale: "ko-KR", gender: "Female" }}
      />,
    );

    await waitFor(() => expect(container.querySelector(".voice-avatar img")).not.toBeNull());
  });
});
