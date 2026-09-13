import type { Readable } from "node:stream";
import { MsEdgeTTS, OUTPUT_FORMAT } from "msedge-tts";
import type { Voice } from "msedge-tts";

export interface EdgeClient {
  getVoices(): Promise<readonly Voice[]>;
  setMetadata(voiceName: string, outputFormat: OUTPUT_FORMAT): Promise<void>;
  toStream(input: string): {
    audioStream: Readable;
  };
  close(): void;
}

export type EdgeClientFactory = () => EdgeClient;

export const defaultEdgeClientFactory: EdgeClientFactory = () => new MsEdgeTTS();
