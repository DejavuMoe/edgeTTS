import { VoicesResponseSchema, HealthResponseSchema } from "@edgetts/shared";
import { createApp } from "../src/app.js";
import { createProductionDependencies } from "../src/composition.js";

async function consumeAudioStream(res: Response): Promise<{ chunks: number; bytes: number }> {
  if (!res.body) {
    throw new Error("Response body is null");
  }
  const reader = res.body.getReader();
  let chunks = 0;
  let bytes = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) {
      break;
    }
    if (value) {
      chunks++;
      bytes += value.byteLength;
    }
  }
  return { chunks, bytes };
}

async function runSmoke(): Promise<void> {
  const dependencies = createProductionDependencies();
  const app = createApp(dependencies);

  try {
    await app.listen({ host: "127.0.0.1", port: 0 });
    const address = app.addresses()[0];
    if (!address) {
      throw new Error("Server failed to bind to a local address");
    }
    const baseUrl = `http://127.0.0.1:${address.port}`;

    // 1. Check GET /api/health
    const healthRes = await fetch(`${baseUrl}/api/health`);
    if (healthRes.status !== 200) {
      throw new Error(`Health check returned status ${healthRes.status}`);
    }
    const healthJson: unknown = await healthRes.json();
    const healthParsed = HealthResponseSchema.parse(healthJson);
    if (healthParsed.status !== "ok") {
      throw new Error(`Health check returned status: ${healthParsed.status}`);
    }

    // 2. Check GET /api/voices
    const voicesRes = await fetch(`${baseUrl}/api/voices`);
    if (voicesRes.status !== 200) {
      throw new Error(`Voices endpoint returned status ${voicesRes.status}`);
    }
    const voicesJson: unknown = await voicesRes.json();
    const voicesParsed = VoicesResponseSchema.parse(voicesJson);
    if (voicesParsed.voices.length === 0) {
      throw new Error("Voices list is empty");
    }

    let selected = voicesParsed.voices.find((v) => v.id === "zh-CN-XiaoxiaoNeural");
    if (!selected) {
      selected = voicesParsed.voices.find((v) => v.locale === "zh-CN");
    }
    if (!selected) {
      throw new Error("No zh-CN voice found in voices list");
    }

    // 3. Check POST /v1/audio/speech (tts-1)
    const tts1Res = await fetch(`${baseUrl}/v1/audio/speech`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model: "tts-1",
        voice: selected.id,
        input: "你好，这是语音接口测试。",
        response_format: "mp3",
        speed: 1,
      }),
    });

    if (tts1Res.status !== 200) {
      throw new Error(`tts-1 speech request returned status ${tts1Res.status}`);
    }
    const tts1ContentType = tts1Res.headers.get("content-type") ?? "";
    if (!tts1ContentType.startsWith("audio/mpeg")) {
      throw new Error(`tts-1 unexpected content-type: ${tts1ContentType}`);
    }
    if (tts1Res.headers.get("content-length") !== null) {
      throw new Error("tts-1 response unexpectedly had content-length header");
    }

    const tts1Result = await consumeAudioStream(tts1Res);
    if (tts1Result.chunks <= 0 || tts1Result.bytes <= 1000) {
      throw new Error(
        `tts-1 audio stream insufficient: ${tts1Result.chunks} chunks, ${tts1Result.bytes} bytes`,
      );
    }

    // 4. Check POST /v1/audio/speech (tts-1-hd)
    const tts1HdRes = await fetch(`${baseUrl}/v1/audio/speech`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model: "tts-1-hd",
        voice: selected.id,
        input: "高清语音测试。",
        response_format: "mp3",
        speed: 1,
      }),
    });

    if (tts1HdRes.status !== 200) {
      throw new Error(`tts-1-hd speech request returned status ${tts1HdRes.status}`);
    }
    const tts1HdContentType = tts1HdRes.headers.get("content-type") ?? "";
    if (!tts1HdContentType.startsWith("audio/mpeg")) {
      throw new Error(`tts-1-hd unexpected content-type: ${tts1HdContentType}`);
    }
    if (tts1HdRes.headers.get("content-length") !== null) {
      throw new Error("tts-1-hd response unexpectedly had content-length header");
    }

    const tts1HdResult = await consumeAudioStream(tts1HdRes);
    if (tts1HdResult.chunks <= 0 || tts1HdResult.bytes <= 1000) {
      throw new Error(
        `tts-1-hd audio stream insufficient: ${tts1HdResult.chunks} chunks, ${tts1HdResult.bytes} bytes`,
      );
    }

    console.log("Server HTTP smoke test\n");
    console.log("Health:");
    console.log("200 PASS\n");
    console.log("Voices:");
    console.log(`Count: ${voicesParsed.voices.length}`);
    console.log(`Selected: ${selected.id}`);
    console.log("PASS\n");
    console.log("Speech tts-1:");
    console.log(`Status: ${tts1Res.status}`);
    console.log(`Content-Type: audio/mpeg`);
    console.log(`HTTP chunks: ${tts1Result.chunks}`);
    console.log(`Bytes: ${tts1Result.bytes}`);
    console.log("PASS\n");
    console.log("Speech tts-1-hd:");
    console.log(`Status: ${tts1HdRes.status}`);
    console.log(`Content-Type: audio/mpeg`);
    console.log(`HTTP chunks: ${tts1HdResult.chunks}`);
    console.log(`Bytes: ${tts1HdResult.bytes}`);
    console.log("PASS\n");
    console.log("PASS");
  } finally {
    await app.close();
  }
}

runSmoke().catch((err: unknown) => {
  console.error("Server HTTP smoke test FAILED:", err);
  process.exit(1);
});
