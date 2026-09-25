import { useI18n } from "../i18n.js";
import React from "react";

export interface SliderProps {
  id: string;
  label: string;
  value: number;
  formattedValue: string;
  min: number;
  max: number;
  step: number;
  onChange: (value: number) => void;
  onReset?: () => void;
  isDefault?: boolean;
  resetAriaLabel?: string;
  disabled?: boolean;
  className?: string;
}

export function Slider({
  id,
  label,
  value,
  formattedValue,
  min,
  max,
  step,
  onChange,
  onReset,
  isDefault = false,
  resetAriaLabel,
  disabled = false,
  className = "",
}: SliderProps) {
  const { t } = useI18n();
  const percentage = Math.max(0, Math.min(100, ((value - min) / (max - min || 1)) * 100));

  return (
    <div className={`control-group ui-slider-group ${className}`}>
      <div className="control-header">
        <label htmlFor={id} className="control-label">
          {label}
        </label>
        {onReset && (
          <button
            type="button"
            className="btn-reset"
            onClick={onReset}
            disabled={disabled || isDefault}
            aria-label={resetAriaLabel ?? t("重置")}
            title={t("重置")}
          >
            <svg
              viewBox="0 0 16 16"
              width="14"
              height="14"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.5"
              strokeLinecap="round"
              strokeLinejoin="round"
              aria-hidden="true"
            >
              <path d="M3 8a5 5 0 1 0 1.5-3.55" />
              <path d="M3 2.5v2.5h2.5" />
            </svg>
          </button>
        )}
        <span className="control-value">{formattedValue}</span>
      </div>
      <div className="ui-slider-track-wrap">
        <input
          id={id}
          type="range"
          className="control-slider"
          min={min}
          max={max}
          step={step}
          value={value}
          onChange={(e) => onChange(parseFloat(e.target.value))}
          disabled={disabled}
          style={
            {
              "--slider-progress": `${percentage}%`,
            } as React.CSSProperties
          }
        />
      </div>
    </div>
  );
}
