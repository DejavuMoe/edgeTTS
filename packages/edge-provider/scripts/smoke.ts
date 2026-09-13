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

  // Step C: Default synthesis
  const defaultText = "你好，这是 Edge TTS 自托管服务测试。";
  const defaultAc = new AbortController();
  const defaultResult = await provider.synthesize(
    {
      text: defaultText,
      voice: selected.id,
      format: "mp3-48k",
    },
    defaultAc.signal,
  );

  if (defaultResult.format !== "mp3-48k") {
    throw new Error(`Smoke failed: expected format mp3-48k, got ${defaultResult.format}`);
  }
  if (defaultResult.contentType !== "audio/mpeg") {
    throw new Error(
      `Smoke failed: expected contentType audio/mpeg, got ${defaultResult.contentType}`,
    );
  }

  let defaultChunkCount = 0;
  let defaultTotalBytes = 0;

  for await (const chunk of defaultResult.audio) {
    defaultChunkCount++;
    defaultTotalBytes += chunk.byteLength;
  }

  if (defaultChunkCount === 0) {
    throw new Error("Smoke failed: default chunk count is 0");
  }
  if (defaultTotalBytes <= 1000) {
    throw new Error(`Smoke failed: default total bytes <= 1000 (got ${defaultTotalBytes})`);
  }

  // Step D: Prosody synthesis
  const prosodyText = "你好，这是语音参数测试。";
  const prosodyAc = new AbortController();
  const prosodyResult = await provider.synthesize(
    {
      text: prosodyText,
      voice: selected.id,
      format: "mp3-48k",
      prosody: {
        speed: 1.25,
        pitchSemitones: 2,
        volume: 0.8,
      },
    },
    prosodyAc.signal,
  );

  if (prosodyResult.format !== "mp3-48k") {
    throw new Error(`Smoke failed: expected format mp3-48k, got ${prosodyResult.format}`);
  }
  if (prosodyResult.contentType !== "audio/mpeg") {
    throw new Error(
      `Smoke failed: expected contentType audio/mpeg, got ${prosodyResult.contentType}`,
    );
  }

  let prosodyChunkCount = 0;
  let prosodyTotalBytes = 0;

  for await (const chunk of prosodyResult.audio) {
    prosodyChunkCount++;
    prosodyTotalBytes += chunk.byteLength;
  }

  if (prosodyChunkCount === 0) {
    throw new Error("Smoke failed: prosody chunk count is 0");
  }
  if (prosodyTotalBytes <= 1000) {
    throw new Error(`Smoke failed: prosody total bytes <= 1000 (got ${prosodyTotalBytes})`);
  }

  console.log("Edge TTS smoke test\n");
  console.log(`Voices: ${voices.length}`);
  console.log(`Selected: ${selected.id}\n`);
  console.log("Default synthesis:");
  console.log(`Chunks: ${defaultChunkCount}`);
  console.log(`Bytes: ${defaultTotalBytes}`);
  console.log("PASS\n");
  console.log("Prosody synthesis:");
  console.log("Speed: 1.25");
  console.log("Pitch: +2st");
  console.log("Volume: 80");
  console.log(`Chunks: ${prosodyChunkCount}`);
  console.log(`Bytes: ${prosodyTotalBytes}`);
  console.log("PASS");
}

runSmoke().catch((err: unknown) => {
  console.error("Smoke test FAILED:", err);
  process.exit(1);
});
