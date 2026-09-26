import type { Readable } from "node:stream";
import { MsEdgeTTS, OUTPUT_FORMAT } from "msedge-tts";
import type { MetadataOptions, ProsodyOptions, Voice } from "msedge-tts";

export interface EdgeClient {
  getVoices(signal: AbortSignal): Promise<readonly Voice[]>;
  /**
   * Connects, or keeps the open connection when voice, format and options are unchanged.
   * Pass metadataOptions on every call: msedge-tts throws on repeat calls without it.
   */
  setMetadata(
    voiceName: string,
    outputFormat: OUTPUT_FORMAT,
    metadataOptions?: MetadataOptions,
  ): Promise<void>;
  toStream(
    input: string,
    options?: ProsodyOptions,
  ): {
    audioStream: Readable;
  };
  close(): void;
}

export type EdgeClientFactory = () => EdgeClient;

export const defaultEdgeClientFactory: EdgeClientFactory = () => new MsEdgeTTS();
