export interface TtsVoice {
  readonly id: string;
  readonly name: string;
  readonly locale: string;
}

export interface SynthesisRequest {
  readonly text: string;
  readonly voice: string;
}

export interface AudioChunk {
  readonly data: Uint8Array;
}

export interface TtsProvider {
  listVoices(): Promise<readonly TtsVoice[]>;

  synthesize(request: SynthesisRequest, signal: AbortSignal): AsyncIterable<AudioChunk>;
}
