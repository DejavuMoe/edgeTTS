import { forwardRef, useEffect, useId, useImperativeHandle, useMemo, useRef } from "react";
import type { KeyboardEvent } from "react";
import { useI18n } from "../i18n.js";
import { formatVoiceGender, type VoiceGroup } from "../lib/voice-catalog.js";
import { localeDisplayName, shortVoiceName } from "../lib/voice-names.js";

export interface VoiceListProps {
  readonly groups: readonly VoiceGroup[];
  readonly selectedVoiceId: string;
  readonly onSelect: (voiceId: string) => void;
  readonly "aria-label": string;
  readonly disabled: boolean;
  /** Shown instead of options when nothing matches the filters. */
  readonly emptyMessage: string;
}

const PAGE_STEP = 8;

/**
 * An always-visible single-select listbox. Selection follows focus (choosing a voice is cheap
 * and reversible), which keeps arrow-key browsing to one keystroke per voice.
 */
export const VoiceList = forwardRef<HTMLDivElement | null, VoiceListProps>(function VoiceList(
  { groups, selectedVoiceId, onSelect, "aria-label": ariaLabel, disabled, emptyMessage },
  ref,
) {
  const { locale } = useI18n();
  const listRef = useRef<HTMLDivElement | null>(null);
  useImperativeHandle(ref, () => listRef.current as HTMLDivElement);
  const idPrefix = useId();
  const optionId = (voiceId: string) => `${idPrefix}-${voiceId}`;

  const orderedIds = useMemo(
    () => groups.flatMap((group) => group.voices.map((voice) => voice.id)),
    [groups],
  );
  const selectedIndex = orderedIds.indexOf(selectedVoiceId);
  const isEmpty = orderedIds.length === 0;
  const inactive = disabled || isEmpty;

  // Keep the selected voice in view when it changes by keyboard, filter or restore. Only the
  // list scrolls: scrollIntoView would also move the page, e.g. jump to the list on mobile.
  useEffect(() => {
    const list = listRef.current;
    if (!list || selectedIndex < 0) return;
    const option = document.getElementById(optionId(selectedVoiceId));
    if (!option) return;
    const header = option.parentElement?.querySelector<HTMLElement>(".voice-group-header");
    const top = option.offsetTop - (header?.offsetHeight ?? 0);
    const bottom = option.offsetTop + option.offsetHeight;
    if (top < list.scrollTop) {
      list.scrollTop = top;
    } else if (bottom > list.scrollTop + list.clientHeight) {
      list.scrollTop = bottom - list.clientHeight;
    }
    // optionId is derived from the stable idPrefix.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedVoiceId, selectedIndex]);

  const handleKeyDown = (event: KeyboardEvent<HTMLDivElement>): void => {
    if (inactive) return;
    const last = orderedIds.length - 1;
    const current = selectedIndex < 0 ? -1 : selectedIndex;
    const targets: Record<string, number> = {
      ArrowDown: Math.min(last, current + 1),
      ArrowUp: Math.max(0, current < 0 ? 0 : current - 1),
      PageDown: Math.min(last, current + PAGE_STEP),
      PageUp: Math.max(0, current - PAGE_STEP),
      Home: 0,
      End: last,
    };
    const target = targets[event.key];
    if (target === undefined) return;
    event.preventDefault();
    const voiceId = orderedIds[target];
    if (voiceId && voiceId !== selectedVoiceId) onSelect(voiceId);
  };

  return (
    <div
      ref={listRef}
      className="voice-list"
      role="listbox"
      aria-label={ariaLabel}
      aria-disabled={inactive}
      aria-activedescendant={selectedIndex >= 0 ? optionId(selectedVoiceId) : undefined}
      data-value={selectedVoiceId}
      tabIndex={inactive ? -1 : 0}
      onKeyDown={handleKeyDown}
    >
      {isEmpty ? (
        <p className="voice-list-empty">{emptyMessage}</p>
      ) : (
        groups.map((group) => {
          const regionName = group.locale ? localeDisplayName(group.locale, locale) : null;
          return (
            <div key={group.label} role="group" aria-label={group.label} className="voice-group">
              <div className="voice-group-header" aria-hidden="true">
                <span>{regionName ?? group.label}</span>
                {regionName && <span className="voice-group-code">{group.locale}</span>}
              </div>
              {group.voices.map((voice) => {
                const selected = voice.id === selectedVoiceId;
                return (
                  <div
                    key={voice.id}
                    id={optionId(voice.id)}
                    role="option"
                    aria-selected={selected}
                    data-value={voice.id}
                    className="voice-option"
                    title={voice.displayName}
                    onClick={() => {
                      if (inactive) return;
                      onSelect(voice.id);
                      listRef.current?.focus();
                    }}
                  >
                    <span className="voice-option-name">{shortVoiceName(voice)}</span>
                    <span className="voice-option-meta">
                      {voice.locale} · {formatVoiceGender(voice.gender, locale)}
                    </span>
                  </div>
                );
              })}
            </div>
          );
        })
      )}
    </div>
  );
});
