import { EdgeTtsProvider } from "@edgetts/edge-provider";
import { TtsService } from "../src/index.js";

async function runSmoke(): Promise<void> {
  const provider = new EdgeTtsProvider();
  const service = new TtsService(provider);

  // 1. Initial voice listing
  const initialVoices = await service.listVoices();
  if (initialVoices.length === 0) {
    throw new Error("Smoke failed: initial voice list is empty");
  }

  // Select zh-CN voice
  let selected = initialVoices.find((v) => v.id === "zh-CN-XiaoxiaoNeural");
  if (!selected) {
    selected = initialVoices.find((v) => v.locale === "zh-CN");
  }
  if (!selected) {
    throw new Error("Smoke failed: no zh-CN voice available");
  }

  // 2. Cached voice lookup
  const cachedVoices = await service.listVoices();
  if (cachedVoices.length !== initialVoices.length) {
    throw new Error(
      `Smoke failed: cached voices length mismatch (${cachedVoices.length} vs ${initialVoices.length})`,
    );
  }

  // 3. Forced refresh
  const refreshedVoices = await service.listVoices({ forceRefresh: true });
  if (refreshedVoices.length === 0) {
    throw new Error("Smoke failed: refreshed voice list is empty");
  }

  // 4. Synthesis via service
  const text = "你好，这是 TTS Service 集成测试。";
  const ac = new AbortController();
  const result = await service.synthesize(
    {
      text,
      voice: selected.id,
      format: "mp3-48k",
      prosody: {
        speed: 1,
        pitchSemitones: 0,
        volume: 1,
      },
    },
    ac.signal,
  );

  if (result.format !== "mp3-48k") {
    throw new Error(`Smoke failed: expected format mp3-48k, got ${result.format}`);
  }
  if (result.contentType !== "audio/mpeg") {
    throw new Error(`Smoke failed: expected contentType audio/mpeg, got ${result.contentType}`);
  }

  let chunkCount = 0;
  let totalBytes = 0;

  for await (const chunk of result.audio) {
    chunkCount++;
    totalBytes += chunk.byteLength;
  }

  if (chunkCount === 0) {
    throw new Error("Smoke failed: chunk count is 0");
  }
  if (totalBytes <= 1000) {
    throw new Error(`Smoke failed: total bytes <= 1000 (got ${totalBytes})`);
  }

  console.log("TTS Service smoke test\n");
  console.log(`Voices: ${initialVoices.length}`);
  console.log(`Selected: ${selected.id}`);
  console.log("Cached lookup: PASS");
  console.log("Forced refresh: PASS\n");
  console.log("Synthesis:");
  console.log(`Format: ${result.format}`);
  console.log(`Chunks: ${chunkCount}`);
  console.log(`Bytes: ${totalBytes}`);
  console.log("PASS");
}

runSmoke().catch((err: unknown) => {
  console.error("TTS Service smoke test FAILED:", err);
  process.exit(1);
});
