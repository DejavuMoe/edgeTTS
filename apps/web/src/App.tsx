import { useRef, useState } from "react";
import { I18nProvider, useI18n } from "./i18n.js";
import { loadWorkbenchPreferences, type WorkbenchPreferencesV1 } from "./lib/preferences.js";
import { AuthCard } from "./workbench/AuthCard.js";
import { ClearTextDialog } from "./workbench/ClearTextDialog.js";
import { CurrentVoiceButton } from "./workbench/CurrentVoiceButton.js";
import { EditorPanel } from "./workbench/EditorPanel.js";
import { ParameterControls } from "./workbench/ParameterControls.js";
import { ResultPanel } from "./workbench/ResultPanel.js";
import { SynthesisActions } from "./workbench/SynthesisActions.js";
import { useGenerateShortcut } from "./workbench/useGenerateShortcut.js";
import { useSynthesis } from "./workbench/useSynthesis.js";
import { useSynthesisFocus } from "./workbench/useSynthesisFocus.js";
import { useSynthesisParameters } from "./workbench/useSynthesisParameters.js";
import { useTextDocument } from "./workbench/useTextDocument.js";
import { useVoiceFilters } from "./workbench/useVoiceFilters.js";
import { useWorkbenchConnection } from "./workbench/useWorkbenchConnection.js";
import { VoicePicker } from "./workbench/VoicePicker.js";
import { WorkbenchHeader } from "./workbench/WorkbenchHeader.js";
import "./styles/index.css";

export { isValidApiKeyFormat, MIN_API_KEY_LENGTH } from "./workbench/useWorkbenchConnection.js";

export function App() {
  return (
    <I18nProvider>
      <Workbench />
    </I18nProvider>
  );
}

function Workbench() {
  const { locale, t } = useI18n();
  const clearDialogRef = useRef<HTMLDialogElement>(null);
  const cancelButtonRef = useRef<HTMLButtonElement>(null);
  const synthesizeButtonRef = useRef<HTMLButtonElement>(null);
  const playButtonRef = useRef<HTMLButtonElement>(null);
  const voicePickerRef = useRef<HTMLElement>(null);
  // Synchronous preference hydration on initial render
  const [initialPreferences] = useState<WorkbenchPreferencesV1>(() => loadWorkbenchPreferences());

  const connection = useWorkbenchConnection(initialPreferences.voiceId);
  const { voices, selectedVoiceId, auth } = connection;
  const filters = useVoiceFilters(voices, selectedVoiceId, locale, t);
  const parameters = useSynthesisParameters(initialPreferences, selectedVoiceId);
  const textDocument = useTextDocument();
  const synthesis = useSynthesis({
    getApiKey: connection.getApiKey,
    onUnauthorized: connection.requireReauthentication,
  });
  const { isGenerating } = synthesis;
  useSynthesisFocus(isGenerating, synthesis.audioSrc !== null, {
    cancel: cancelButtonRef,
    synthesize: synthesizeButtonRef,
    play: playButtonRef,
  });

  const canGenerate =
    !isGenerating &&
    !textDocument.isImporting &&
    !textDocument.isEmpty &&
    !textDocument.isOverLimit &&
    Boolean(selectedVoiceId) &&
    !auth.required;

  const handleGenerate = (): void => {
    if (!canGenerate) {
      return;
    }
    const { quality, speed, pitchSemitones, volume } = parameters;
    const voiceDisplayName =
      voices.find((v) => v.id === selectedVoiceId)?.displayName ?? selectedVoiceId;
    void synthesis.generate(
      { input: textDocument.text, voice: selectedVoiceId, quality, speed, pitchSemitones, volume },
      { voiceId: selectedVoiceId, voiceDisplayName, quality, speed, pitchSemitones, volume },
    );
  };

  useGenerateShortcut(handleGenerate);

  /** Brings the voice picker into view with focus in the voice list, ready to choose. */
  const showVoicePicker = (): void => {
    const picker = voicePickerRef.current;
    if (!picker) return;
    const reduceMotion = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
    picker.scrollIntoView({ block: "start", behavior: reduceMotion ? "auto" : "smooth" });
    picker.querySelector<HTMLElement>('[role="listbox"]')?.focus({ preventScroll: true });
  };

  const handleRequestClear = (): void => {
    if (!isGenerating && textDocument.text.length > 0) clearDialogRef.current?.showModal();
  };

  const handleConfirmClear = (): void => {
    textDocument.clear();
    clearDialogRef.current?.close();
  };

  return (
    <div className="app">
      <WorkbenchHeader apiStatus={connection.apiStatus} />
      <ClearTextDialog dialogRef={clearDialogRef} onConfirm={handleConfirmClear} />

      <main className="workbench">
        {/* Above the text on phones, atop the inspector column on wider screens. */}
        {auth.required && <AuthCard auth={auth} />}
        <EditorPanel
          textDocument={textDocument}
          isGenerating={isGenerating}
          onRequestClear={handleRequestClear}
          actions={
            <>
              <CurrentVoiceButton
                voice={voices.find((v) => v.id === selectedVoiceId)}
                onClick={showVoicePicker}
              />
              <SynthesisActions
                synthesis={synthesis}
                canGenerate={canGenerate}
                onGenerate={handleGenerate}
                cancelButtonRef={cancelButtonRef}
                synthesizeButtonRef={synthesizeButtonRef}
              />
            </>
          }
        />
        <ResultPanel synthesis={synthesis} playButtonRef={playButtonRef} />

        <aside className="inspector" aria-label={t("语音参数配置")}>
          <VoicePicker
            sectionRef={voicePickerRef}
            voices={voices}
            voiceError={connection.voiceError}
            selectedVoiceId={selectedVoiceId}
            onSelectVoice={connection.selectVoice}
            filters={filters}
            catalogStatus={connection.catalogStatus}
          />
          <ParameterControls parameters={parameters} />
        </aside>
      </main>
    </div>
  );
}
