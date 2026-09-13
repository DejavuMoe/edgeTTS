import { VoicesResponseSchema, HealthResponseSchema } from "@edgetts/shared";
import { createApp } from "../src/app.js";
import { createProductionDependencies } from "../src/composition.js";

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

    // 3. Check second GET /api/voices request
    const secondVoicesRes = await fetch(`${baseUrl}/api/voices`);
    if (secondVoicesRes.status !== 200) {
      throw new Error(`Second voices request returned status ${secondVoicesRes.status}`);
    }
    const secondVoicesJson: unknown = await secondVoicesRes.json();
    const secondVoicesParsed = VoicesResponseSchema.parse(secondVoicesJson);
    if (secondVoicesParsed.voices.length !== voicesParsed.voices.length) {
      throw new Error("Second voices request returned mismatched voice count");
    }

    console.log("Server HTTP smoke test\n");
    console.log("Health:");
    console.log(`Status: ${healthRes.status}`);
    console.log("PASS\n");
    console.log("Voices:");
    console.log(`Status: ${voicesRes.status}`);
    console.log(`Count: ${voicesParsed.voices.length}`);
    console.log("zh-CN available: yes");
    console.log(`Selected: ${selected.id}`);
    console.log("Second request: PASS\n");
    console.log("PASS");
  } finally {
    await app.close();
  }
}

runSmoke().catch((err: unknown) => {
  console.error("Server HTTP smoke test FAILED:", err);
  process.exit(1);
});
