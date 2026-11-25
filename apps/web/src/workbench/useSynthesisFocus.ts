import { useEffect, useRef, type RefObject } from "react";

export interface SynthesisFocusTargets {
  /** Shown only while a synthesis runs. */
  readonly cancel: RefObject<HTMLButtonElement | null>;
  readonly synthesize: RefObject<HTMLButtonElement | null>;
  /** The finished take's play button, present once there is audio. */
  readonly play: RefObject<HTMLButtonElement | null>;
}

/**
 * Starting a synthesis disables the control that started it, and finishing one removes the
 * cancel button, so focus would fall back to the page and a keyboard user would start again
 * from the top. Focus moves to cancel when a synthesis starts, then to the take's play button
 * when it is ready, or back to synthesize when it was cancelled or failed. Focus the user has
 * put on another control that is still usable stays where it is.
 */
export function useSynthesisFocus(
  isGenerating: boolean,
  hasAudio: boolean,
  targets: SynthesisFocusTargets,
): void {
  const wasGenerating = useRef(isGenerating);
  const { cancel, synthesize, play } = targets;

  useEffect(() => {
    if (wasGenerating.current === isGenerating) return;
    wasGenerating.current = isGenerating;
    if (!focusIsLost()) return;
    const target = isGenerating ? cancel : hasAudio ? play : synthesize;
    const element = target.current;
    if (element && !element.disabled) element.focus();
  }, [isGenerating, hasAudio, cancel, synthesize, play]);
}

/** Nothing usable has focus: the page itself, or a control that was disabled or removed. */
function focusIsLost(): boolean {
  const active = document.activeElement;
  if (!active || active === document.body || active === document.documentElement) return true;
  if (!active.isConnected) return true;
  return active.matches(":disabled");
}
