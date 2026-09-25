import { useId, useMemo } from "react";
import { useI18n } from "../i18n.js";
import { SegmentedControl, Slider } from "../ui/index.js";
import type { Quality, useSynthesisParameters } from "./useSynthesisParameters.js";

export interface ParameterControlsProps {
  readonly parameters: ReturnType<typeof useSynthesisParameters>;
  readonly disabled: boolean;
}

export function ParameterControls({ parameters, disabled }: ParameterControlsProps) {
  const { t } = useI18n();
  const titleId = useId();
  const speedSliderId = useId();
  const pitchSliderId = useId();
  const volumeSliderId = useId();
  const { quality, speed, pitchSemitones, volume } = parameters;

  const qualityOptions = useMemo(
    () =>
      [
        { value: "standard", label: t("标准"), detail: "48 kbps" },
        { value: "high", label: t("高品质"), detail: "96 kbps" },
      ] as const satisfies readonly { value: Quality; label: string; detail: string }[],
    [t],
  );

  return (
    <section className="inspector-section delivery-section" aria-labelledby={titleId}>
      <div className="section-header">
        <h2 id={titleId} className="section-title">
          {t("表达")}
        </h2>
        <button
          type="button"
          className="btn-text btn-reset-params"
          onClick={parameters.resetAll}
          disabled={disabled || parameters.isAllDefault}
          aria-label={t("恢复默认参数")}
        >
          {t("恢复默认")}
        </button>
      </div>

      <div className="delivery-row">
        <span className="control-label" aria-hidden="true">
          {t("音质")}
        </span>
        <SegmentedControl
          aria-label={t("音质")}
          value={quality}
          options={qualityOptions}
          onChange={parameters.setQuality}
          disabled={disabled}
        />
      </div>

      <Slider
        id={speedSliderId}
        label={t("语速")}
        value={speed}
        formattedValue={`${speed.toFixed(2)}×`}
        min={0.5}
        max={2.0}
        step={0.05}
        onChange={parameters.setSpeed}
        onReset={() => parameters.setSpeed(1.0)}
        isDefault={speed === 1.0}
        resetAriaLabel={t("重置语速")}
        disabled={disabled}
      />

      <Slider
        id={pitchSliderId}
        label={t("音调")}
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

      <Slider
        id={volumeSliderId}
        label={t("音量")}
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
    </section>
  );
}
