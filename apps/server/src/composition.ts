import { EdgeTtsProvider } from "@edgetts/edge-provider";
import { TtsService } from "@edgetts/tts-service";
import type { AppDependencies } from "./dependencies.js";

export function createProductionDependencies(): AppDependencies {
  const provider = new EdgeTtsProvider();
  const ttsService = new TtsService(provider);
  return { ttsService };
}
