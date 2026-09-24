import { EdgeTtsProvider } from "@edgetts/edge-provider";
import { TtsService } from "@edgetts/tts-service";
import type { TtsTuning } from "./config.js";
import type { AppDependencies } from "./dependencies.js";

export function createProductionDependencies(tuning?: TtsTuning): AppDependencies {
  const provider = new EdgeTtsProvider(tuning?.provider);
  const ttsService = new TtsService(provider, tuning?.service);
  return { ttsService };
}
