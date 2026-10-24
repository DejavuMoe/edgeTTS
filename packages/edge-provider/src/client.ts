import { randomUUID } from "node:crypto";
import { Readable } from "node:stream";
import WebSocket, { type RawData } from "ws";
import { isValidVoiceId } from "@edgetts/tts-core";
import { createSynthesisUrl, TRUSTED_CLIENT_TOKEN } from "./authentication.js";
import { toEdgeProsody, type EdgeProsody } from "./prosody.js";
import { escapeXmlText } from "./xml.js";

export type EdgeOutputFormat =
  | "audio-24khz-48kbitrate-mono-mp3"
  | "audio-24khz-96kbitrate-mono-mp3"
  | "webm-24khz-16bit-mono-opus";

export interface EdgeVoice {
  readonly Name?: string;
  readonly ShortName: string;
  readonly FriendlyName: string;
  readonly Locale: string;
  readonly Gender: string;
  readonly Status?: string;
  readonly SuggestedCodec?: string;
}

export interface EdgeClient {
  getVoices(signal: AbortSignal): Promise<readonly EdgeVoice[]>;
  /** Reuses the connection when voice and format are unchanged. */
  setMetadata(voiceName: string, outputFormat: EdgeOutputFormat): Promise<void>;
  /** Input has already been XML-escaped by the provider. */
  toStream(input: string, options?: EdgeProsody): { audioStream: Readable };
  close(): void;
}

export type EdgeClientFactory = () => EdgeClient;

interface ActiveTurn {
  readonly id: string;
  readonly socket: WebSocket;
  readonly audio: Readable;
}

export class NativeEdgeClient implements EdgeClient {
  private socket: WebSocket | undefined;
  private generation = 0;
  private voice = "";
  private format: EdgeOutputFormat | undefined;
  private active: ActiveTurn | undefined;

  static getSynthUrl(): Promise<string> {
    return Promise.resolve(createSynthesisUrl());
  }

  async getVoices(signal: AbortSignal): Promise<readonly EdgeVoice[]> {
    const response = await fetch(
      `https://speech.platform.bing.com/consumer/speech/synthesize/readaloud/voices/list?trustedclienttoken=${TRUSTED_CLIENT_TOKEN}`,
      { signal },
    );
    if (!response.ok) {
      await response.body?.cancel();
      throw new Error(`Edge voice discovery returned HTTP ${response.status}`);
    }
    const voices: unknown = await response.json();
    if (!Array.isArray(voices) || !voices.every(isEdgeVoice)) {
      throw new Error("Edge voice discovery returned an invalid voice catalog");
    }
    return voices;
  }

  async setMetadata(voiceName: string, outputFormat: EdgeOutputFormat): Promise<void> {
    if (!isValidVoiceId(voiceName)) throw new Error("Invalid Edge voice identifier");
    if (
      this.socket?.readyState === WebSocket.OPEN &&
      this.voice === voiceName &&
      this.format === outputFormat
    )
      return;

    this.close();
    this.voice = voiceName;
    this.format = outputFormat;
    const generation = this.generation;
    const url = await NativeEdgeClient.getSynthUrl();
    if (generation !== this.generation)
      throw new Error("Edge TTS connection initialization was closed");

    const socket = new WebSocket(url, {
      headers: {
        "User-Agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/143.0.0.0 Safari/537.36 Edg/143.0.0.0",
        Origin: "chrome-extension://jdiccldimpdaibmpdkjnbmckianbfold",
      },
      perMessageDeflate: false,
      maxPayload: 1024 * 1024,
    });
    this.socket = socket;
    await new Promise<void>((resolve, reject) => {
      socket.once("open", () => {
        socket.send(
          `Content-Type:application/json; charset=utf-8\r\nPath:speech.config\r\n\r\n${JSON.stringify(
            {
              context: {
                synthesis: {
                  audio: {
                    metadataoptions: { sentenceBoundaryEnabled: false, wordBoundaryEnabled: false },
                    outputFormat,
                  },
                },
              },
            },
          )}`,
          (error) => {
            if (error) {
              reject(error);
              socket.terminate();
            } else resolve();
          },
        );
      });
      socket.on("message", (data, binary) => {
        try {
          this.receive(socket, data, binary);
        } catch {
          this.failTurn(socket, new Error("Invalid Edge TTS protocol frame"));
          socket.terminate();
        }
      });
      socket.on("error", (error) => {
        // ws includes the HTTP status in handshake errors; never include request payloads.
        const failure = new Error(`Edge TTS WebSocket error: ${error.message}`, { cause: error });
        reject(failure);
        this.failTurn(socket, failure);
        socket.terminate();
      });
      socket.on("close", () => {
        reject(new Error("Edge TTS connection closed before initialization completed"));
        this.failTurn(
          socket,
          new Error("Stream closed before synthesis completed (no turn.end received)"),
        );
      });
    });
  }

  toStream(input: string, options = toEdgeProsody()): { audioStream: Readable } {
    const socket = this.socket;
    if (!socket || socket.readyState !== WebSocket.OPEN) {
      throw new Error("Edge TTS WebSocket is not open");
    }
    if (this.active) throw new Error("Edge TTS allows one synthesis at a time");
    const locale = this.voice.slice(0, this.voice.lastIndexOf("-"));
    if (!/^[a-z]{2,3}(?:-[A-Za-z0-9]{2,8})+$/.test(locale))
      throw new Error("Cannot infer the Edge voice locale");
    const id = randomUUID().replaceAll("-", "");
    const audio = new Readable({
      read() {
        socket.resume();
      },
      destroy: (error, callback) => {
        if (this.active?.id === id) this.active = undefined;
        socket.resume();
        callback(error);
      },
    });
    // A send may fail before the caller starts iterating; Readable retains the error.
    audio.on("error", () => {});
    this.active = { id, socket, audio };
    const ssml = `<speak version="1.0" xmlns="http://www.w3.org/2001/10/synthesis" xml:lang="${locale}"><voice name="${this.voice}"><prosody pitch="${escapeXmlText(options.pitch)}" rate="${options.rate}" volume="${options.volume}">${input}</prosody></voice></speak>`;
    socket.send(
      `X-RequestId:${id}\r\nContent-Type:application/ssml+xml\r\nX-Timestamp:${new Date().toUTCString()}\r\nPath:ssml\r\n\r\n${ssml}`,
      (error) => {
        if (error) audio.destroy(error);
      },
    );
    return { audioStream: audio };
  }

  close(): void {
    this.generation++;
    if (this.socket) {
      this.failTurn(
        this.socket,
        new Error("Stream closed before synthesis completed (no turn.end received)"),
      );
      this.socket.terminate();
      this.socket = undefined;
    }
  }

  private failTurn(socket: WebSocket, error: Error): void {
    if (this.active?.socket === socket) this.active.audio.destroy(error);
  }

  private receive(socket: WebSocket, data: RawData, binary: boolean): void {
    const turn = this.active;
    if (!turn || turn.socket !== socket || turn.audio.destroyed) return;
    const buffer = Array.isArray(data)
      ? Buffer.concat(data)
      : Buffer.isBuffer(data)
        ? data
        : Buffer.from(data);
    const headerStart = binary ? 2 : 0;
    if (binary && buffer.length < 2) throw new Error("Missing binary header length");
    const headerEnd = binary ? 2 + buffer.readUInt16BE(0) : buffer.indexOf("\r\n\r\n");
    if (headerEnd < headerStart || headerEnd > buffer.length)
      throw new Error("Invalid header length");
    const headers = new Map(
      buffer
        .subarray(headerStart, headerEnd)
        .toString()
        .split("\r\n")
        .map((line) => {
          const colon = line.indexOf(":");
          return [line.slice(0, colon).toLowerCase(), line.slice(colon + 1)];
        }),
    );
    const path = headers.get("path");
    const requestId = headers.get("x-requestid");
    if (!path || !requestId) throw new Error("Missing frame headers");
    if (requestId !== turn.id) return;
    if (binary) {
      if (path !== "audio") throw new Error("Unexpected binary frame");
      const audio = buffer.subarray(headerEnd);
      if (audio.length && !turn.audio.push(audio)) socket.pause();
    } else if (path === "turn.end") {
      this.active = undefined;
      turn.audio.push(null);
    }
  }
}

function isEdgeVoice(value: unknown): value is EdgeVoice {
  if (typeof value !== "object" || value === null) return false;
  const voice = value as Record<string, unknown>;
  return (
    ["ShortName", "FriendlyName", "Locale", "Gender"].every(
      (key) => typeof voice[key] === "string" && voice[key].length > 0,
    ) &&
    ["Name", "Status", "SuggestedCodec"].every(
      (key) => voice[key] === undefined || typeof voice[key] === "string",
    ) &&
    isValidVoiceId(voice.ShortName)
  );
}

export const defaultEdgeClientFactory: EdgeClientFactory = () => new NativeEdgeClient();
