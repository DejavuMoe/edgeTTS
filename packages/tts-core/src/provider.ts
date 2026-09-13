export type TtsAudioFormat = "mp3-48k" | "mp3-96k" | "webm-opus";

export interface TtsVoice {
  readonly id: string;
  readonly displayName: string;
  readonly locale: string;
  readonly gender: string;
  readonly status?: string;
  readonly suggestedCodec?: string;
}

export interface SynthesisRequest {
  readonly text: string;
  readonly voice: string;
  readonly format?: TtsAudioFormat;
}

export interface SynthesisResult {
  readonly format: TtsAudioFormat;
  readonly contentType: "audio/mpeg" | "audio/webm";
  readonly audio: AsyncIterable<Uint8Array>;
}

export interface TtsProvider {
  listVoices(): Promise<readonly TtsVoice[]>;

  synthesize(request: SynthesisRequest, signal: AbortSignal): Promise<SynthesisResult>;
}
