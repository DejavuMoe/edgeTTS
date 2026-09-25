import { useId, useMemo } from "react";
import { useI18n } from "../i18n.js";
import { Select, Slider } from "../ui/index.js";
import type { Quality, useSynthesisParameters } from "./useSynthesisParameters.js";

export interface ParameterControlsProps {
  readonly parameters: ReturnType<typeof useSynthesisParameters>;
  readonly disabled: boolean;
}

export function ParameterControls({ parameters, disabled }: ParameterControlsProps) {
  const { t } = useI18n();
  const qualitySelectId = useId();
  const speedSliderId = useId();
  const pitchSliderId = useId();
  const volumeSliderId = useId();
  const { quality, speed, pitchSemitones, volume } = parameters;

  const qualityOptions = useMemo(
    () => [
      { value: "standard", label: t("标准 (48 kbps MP3)") },
      { value: "high", label: t("高品质 (96 kbps MP3)") },
    ],
    [t],
  );

  return (
    <>
      {/* Quality */}
      <div className="control-group">
        <label htmlFor={qualitySelectId} className="control-label">
          {t("音质 (Quality)")}
        </label>
        <Select
          id={qualitySelectId}
          value={quality}
          onChange={(val) => parameters.setQuality(val as Quality)}
          options={qualityOptions}
          disabled={disabled}
          aria-label={t("音质 (Quality)")}
        />
      </div>

      {/* Speed */}
      <Slider
        id={speedSliderId}
        label={t("语速 (Speed)")}
        value={speed}
        formattedValue={`${speed.toFixed(2)}x`}
        min={0.5}
        max={2.0}
        step={0.05}
        onChange={parameters.setSpeed}
        onReset={() => parameters.setSpeed(1.0)}
        isDefault={speed === 1.0}
        resetAriaLabel={t("重置语速")}
        disabled={disabled}
      />

      {/* Pitch */}
      <Slider
        id={pitchSliderId}
        label={t("音调 (Pitch)")}
        value={pitchSemitones}
        formattedValue={t("{value} 半音", {
          value: pitchSemitones > 0 ? `+${pitchSemitones}` : pitchSemitones,
        })}
        min={-12}
        max={12}
        step={1}
        onChange={parameters.setPitchSemitones}
        onReset={() => parameters.setPitchSemitones(0)}
        isDefault={pitchSemitones === 0}
        resetAriaLabel={t("重置音调")}
        disabled={disabled}
      />

      {/* Volume */}
      <Slider
        id={volumeSliderId}
        label={t("音量 (Volume)")}
        value={volume}
        formattedValue={`${Math.round(volume * 100)}%`}
        min={0.0}
        max={1.0}
        step={0.05}
        onChange={parameters.setVolume}
        onReset={() => parameters.setVolume(1.0)}
        isDefault={volume === 1.0}
        resetAriaLabel={t("重置音量")}
        disabled={disabled}
      />

      {/* Reset All Synthesis Parameters */}
      <div className="reset-params-group">
        <button
          type="button"
          className="btn-reset-params"
          onClick={parameters.resetAll}
          disabled={disabled || parameters.isAllDefault}
          aria-label={t("恢复默认参数")}
        >
          {t("恢复默认参数")}
        </button>
      </div>
    </>
  );
}
