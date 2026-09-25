import { useRef, useState } from "react";
import { I18nProvider, useI18n } from "./i18n.js";
import { loadWorkbenchPreferences, type WorkbenchPreferencesV1 } from "./lib/preferences.js";
import { AuthCard } from "./workbench/AuthCard.js";
import { ClearTextDialog } from "./workbench/ClearTextDialog.js";
import { EditorPanel } from "./workbench/EditorPanel.js";
import { ParameterControls } from "./workbench/ParameterControls.js";
import { ResultPanel } from "./workbench/ResultPanel.js";
import { SynthesisActions } from "./workbench/SynthesisActions.js";
import { useSynthesis } from "./workbench/useSynthesis.js";
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

  const canGenerate =
    !isGenerating &&
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
        <EditorPanel
          textDocument={textDocument}
          isGenerating={isGenerating}
          onGenerate={handleGenerate}
          onRequestClear={handleRequestClear}
          actions={
            <SynthesisActions
              synthesis={synthesis}
              canGenerate={canGenerate}
              onGenerate={handleGenerate}
            />
          }
        />
        <ResultPanel synthesis={synthesis} />

        <aside className="inspector" aria-label={t("语音参数配置")}>
          {auth.required && <AuthCard auth={auth} />}
          <VoicePicker
            voices={voices}
            voiceError={connection.voiceError}
            selectedVoiceId={selectedVoiceId}
            onSelectVoice={connection.selectVoice}
            filters={filters}
            disabled={isGenerating}
          />
          <ParameterControls parameters={parameters} disabled={isGenerating} />
        </aside>
      </main>
    </div>
  );
}
