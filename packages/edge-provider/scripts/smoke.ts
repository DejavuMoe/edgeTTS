import { EdgeTtsProvider } from "../src/index.js";

async function runSmoke(): Promise<void> {
  const provider = new EdgeTtsProvider();

  // Step A: listVoices
  const voices = await provider.listVoices();
  if (voices.length === 0) {
    throw new Error("Smoke failed: voices list is empty");
  }

  const sampleVoice = voices[0];
  if (!sampleVoice?.id || !sampleVoice.displayName || !sampleVoice.locale || !sampleVoice.gender) {
    throw new Error("Smoke failed: voice object missing required fields");
  }

  // Step B: Select Chinese voice
  let selected = voices.find((v) => v.id === "zh-CN-XiaoxiaoNeural");
  if (!selected) {
    selected = voices.find((v) => v.locale === "zh-CN");
  }
  if (!selected) {
    throw new Error("Smoke failed: no zh-CN voice available");
  }

  // Step C: Real synthesis
  const text = "你好，这是 Edge TTS 自托管服务测试。";
  const ac = new AbortController();
  const result = await provider.synthesize(
    {
      text,
      voice: selected.id,
      format: "mp3-48k",
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

  console.log("Edge TTS smoke test\n");
  console.log(`Voices: ${voices.length}`);
  console.log(`Selected: ${selected.id}`);
  console.log(`Format: ${result.format}`);
  console.log(`Chunks: ${chunkCount}`);
  console.log(`Bytes: ${totalBytes}\n`);
  console.log("PASS");
}

runSmoke().catch((err: unknown) => {
  console.error("Smoke test FAILED:", err);
  process.exit(1);
});
