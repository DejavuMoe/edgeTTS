import { get as httpGet } from "node:http";
import { get as httpsGet } from "node:https";
import { createProxyAgent } from "./proxy.js";

export async function fetchVoiceCatalog(url: string, signal: AbortSignal): Promise<unknown> {
  const agent = createProxyAgent(url, signal);
  try {
    return await new Promise<unknown>((resolve, reject) => {
      const get = url.startsWith("https:") ? httpsGet : httpGet;
      const request = get(url, { signal, agent: agent ?? false }, (response) => {
        void (async () => {
          if (response.statusCode !== 200) {
            response.destroy();
            throw new Error(`Edge voice discovery returned HTTP ${response.statusCode}`);
          }
          const chunks: Buffer[] = [];
          for await (const chunk of response) chunks.push(Buffer.from(chunk as Uint8Array));
          return JSON.parse(Buffer.concat(chunks).toString()) as unknown;
        })().then(resolve, reject);
      });
      request.on("error", (error) => {
        reject(agent && !signal.aborted ? new Error("Edge voice proxy connection failed") : error);
      });
    });
  } finally {
    agent?.destroy();
  }
}
