export type TtsAudioFormat = "mp3-48k" | "mp3-96k" | "webm-opus";

export interface TtsProsody {
  readonly speed?: number;
  readonly pitchSemitones?: number;
  readonly volume?: number;
}

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
  readonly prosody?: TtsProsody;
}

export interface SynthesisResult {
  readonly format: TtsAudioFormat;
  readonly contentType: "audio/mpeg" | "audio/webm";
  readonly audio: AsyncIterable<Uint8Array>;
}

export interface SynthesisSessionOptions {
  readonly voice: string;
  readonly format?: TtsAudioFormat;
}

export interface SessionSynthesisRequest {
  readonly text: string;
  readonly prosody?: TtsProsody;
}

/**
 * Sequential syntheses that share one voice, format and upstream connection. At most one
 * synthesis may be in flight: the next may start only after the previous audio has ended.
 * The owner must call close() once, whatever the outcome.
 */
export interface SynthesisSession {
  synthesize(request: SessionSynthesisRequest, signal: AbortSignal): Promise<SynthesisResult>;
  close(): void;
}

export interface TtsProvider {
  listVoices(): Promise<readonly TtsVoice[]>;

  synthesize(request: SynthesisRequest, signal: AbortSignal): Promise<SynthesisResult>;

  /** Optional: providers that can keep a connection open across sequential syntheses. */
  openSession?(options: SynthesisSessionOptions, signal: AbortSignal): Promise<SynthesisSession>;
}
