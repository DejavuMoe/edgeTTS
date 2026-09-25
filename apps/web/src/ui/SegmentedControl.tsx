import { useRef, type KeyboardEvent } from "react";

export interface SegmentedOption<T extends string> {
  readonly value: T;
  readonly label: string;
  /** Short supporting text shown under the label, e.g. a bitrate. */
  readonly detail?: string;
}

export interface SegmentedControlProps<T extends string> {
  readonly value: T;
  readonly options: readonly SegmentedOption<T>[];
  readonly onChange: (value: T) => void;
  readonly "aria-label": string;
  readonly disabled?: boolean;
}

/**
 * A small set of mutually exclusive choices, all visible at once. Implements the ARIA radio
 * group pattern: one tab stop on the checked option, arrow keys move and select.
 */
export function SegmentedControl<T extends string>({
  value,
  options,
  onChange,
  "aria-label": ariaLabel,
  disabled = false,
}: SegmentedControlProps<T>) {
  const refs = useRef<(HTMLButtonElement | null)[]>([]);
  const checkedIndex = Math.max(
    0,
    options.findIndex((option) => option.value === value),
  );

  const move = (event: KeyboardEvent<HTMLDivElement>): void => {
    const step =
      event.key === "ArrowRight" || event.key === "ArrowDown"
        ? 1
        : event.key === "ArrowLeft" || event.key === "ArrowUp"
          ? -1
          : 0;
    if (step === 0 || disabled) return;
    event.preventDefault();
    const next = (checkedIndex + step + options.length) % options.length;
    onChange(options[next]!.value);
    refs.current[next]?.focus();
  };

  return (
    <div
      className="segmented"
      role="radiogroup"
      aria-label={ariaLabel}
      aria-disabled={disabled || undefined}
      data-value={value}
      onKeyDown={move}
    >
      {options.map((option, index) => {
        const checked = index === checkedIndex;
        return (
          <button
            key={option.value}
            ref={(element) => {
              refs.current[index] = element;
            }}
            type="button"
            role="radio"
            aria-checked={checked}
            tabIndex={checked ? 0 : -1}
            className="segmented-option"
            disabled={disabled}
            onClick={() => onChange(option.value)}
          >
            <span className="segmented-label">{option.label}</span>
            {option.detail && <span className="segmented-detail">{option.detail}</span>}
          </button>
        );
      })}
    </div>
  );
}
