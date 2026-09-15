import React, { useId } from "react";

export interface CheckboxProps {
  id?: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
  label?: React.ReactNode;
  disabled?: boolean;
  className?: string;
  "aria-label"?: string;
}

export function Checkbox({
  id: explicitId,
  checked,
  onChange,
  label,
  disabled = false,
  className = "",
  "aria-label": ariaLabel,
}: CheckboxProps) {
  const generatedId = useId();
  const id = explicitId || generatedId;

  return (
    <label
      htmlFor={id}
      className={`favorite-checkbox-label ui-checkbox-label ${disabled ? "is-disabled" : ""} ${className}`}
    >
      <span
        className={`ui-checkbox-box ${checked ? "is-checked" : ""} ${disabled ? "is-disabled" : ""}`}
      >
        <input
          id={id}
          type="checkbox"
          className="ui-checkbox-input"
          checked={checked}
          onChange={(e) => onChange(e.target.checked)}
          disabled={disabled}
          aria-label={ariaLabel}
        />
        <svg
          className={`ui-checkbox-icon ${checked ? "is-visible" : ""}`}
          viewBox="0 0 16 16"
          fill="none"
          stroke="currentColor"
          strokeWidth="2.4"
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden="true"
        >
          <polyline points="3.5 8.5 6.5 11.5 12.5 5" />
        </svg>
      </span>
      {label && <span className="ui-checkbox-text">{label}</span>}
    </label>
  );
}
