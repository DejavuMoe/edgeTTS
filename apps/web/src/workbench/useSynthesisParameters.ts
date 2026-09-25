import { useEffect, useRef, useState } from "react";
import {
  DEFAULT_WORKBENCH_PREFERENCES,
  saveWorkbenchPreferences,
  type WorkbenchPreferencesV1,
} from "../preferences.js";

export type Quality = WorkbenchPreferencesV1["quality"];

/**
 * Quality and prosody controls, persisted with the selected voice. Nothing is saved until a
 * voice has been resolved, so an empty initial selection never overwrites stored preferences.
 */
export function useSynthesisParameters(
  initialPreferences: WorkbenchPreferencesV1,
  selectedVoiceId: string,
) {
  const isHydratedRef = useRef<boolean>(false);
  const [quality, setQuality] = useState<Quality>(initialPreferences.quality);
  const [speed, setSpeed] = useState<number>(initialPreferences.speed);
  const [pitchSemitones, setPitchSemitones] = useState<number>(initialPreferences.pitchSemitones);
  const [volume, setVolume] = useState<number>(initialPreferences.volume);

  // Persist non-sensitive preferences only after hydration and when a valid voice is active
  useEffect(() => {
    if (!isHydratedRef.current) {
      if (!selectedVoiceId) {
        return;
      }
      isHydratedRef.current = true;
    }
    saveWorkbenchPreferences({
      voiceId: selectedVoiceId,
      quality,
      speed,
      pitchSemitones,
      volume,
    });
  }, [selectedVoiceId, quality, speed, pitchSemitones, volume]);

  const isAllDefault =
    quality === DEFAULT_WORKBENCH_PREFERENCES.quality &&
    speed === DEFAULT_WORKBENCH_PREFERENCES.speed &&
    pitchSemitones === DEFAULT_WORKBENCH_PREFERENCES.pitchSemitones &&
    volume === DEFAULT_WORKBENCH_PREFERENCES.volume;

  const resetAll = (): void => {
    setQuality(DEFAULT_WORKBENCH_PREFERENCES.quality);
    setSpeed(DEFAULT_WORKBENCH_PREFERENCES.speed);
    setPitchSemitones(DEFAULT_WORKBENCH_PREFERENCES.pitchSemitones);
    setVolume(DEFAULT_WORKBENCH_PREFERENCES.volume);
  };

  return {
    quality,
    setQuality,
    speed,
    setSpeed,
    pitchSemitones,
    setPitchSemitones,
    volume,
    setVolume,
    isAllDefault,
    resetAll,
  };
}
