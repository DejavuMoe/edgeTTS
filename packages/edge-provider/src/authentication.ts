import { createHash, randomUUID } from "node:crypto";

export const TRUSTED_CLIENT_TOKEN = "6A5AA1D4EAFF4E9FB37E23D68491D6F4";
export const SEC_MS_GEC_VERSION = "2-143.0.3650.96";

const rotate16 = (value: number): number => (value << 16) | (value >>> 16);

/** v2 wire algorithm and captured vector: https://github.com/rany2/edge-tts/pull/492 */
export function generateSecMsGec(now = Date.now()): string {
  const seconds = Math.floor(now / 1000) + 11_644_473_600;
  const ticks = (seconds - (seconds % 300)) * 10_000_000;
  // This prefix is protocol data hashed by Edge, including its trailing period.
  const data = Buffer.from(
    `Copyright (C) Microsoft Corporation. All rights reserved.${ticks}${TRUSTED_CLIENT_TOKEN}`,
  );
  const digest = createHash("sha256").update(data).digest();
  const words = Buffer.alloc(Math.ceil(data.length / 8) * 8);
  data.copy(words);
  const a = digest.readUInt32LE(0) | 1;
  const b = digest.readUInt32LE(4) | 1;
  let swapSum = 0;
  let swapLast = 0;
  let state = 0;
  let sum = 0;
  // Math.imul preserves the low 32 bits; ordinary JS multiplication loses precision.
  for (let offset = 0; offset < words.length; offset += 8) {
    const x = words.readUInt32LE(offset);
    const y = words.readUInt32LE(offset + 4);
    let t = rotate16((Math.imul(rotate16(x), 0xef0569fb) + Math.imul(x, a)) | 0);
    let q = Math.imul(t, 0x76f50f34);
    swapSum = (swapSum + Math.imul(rotate16(q), 0xc3efea97) + q) | 0;
    t = rotate16((Math.imul(rotate16(y), 0xc31713db) + Math.imul(y, b)) | 0);
    q = Math.imul(t, 0x1881ce3c);
    swapLast = (Math.imul(rotate16(q), 0x35bd1ec9) + q) | 0;
    swapSum = (swapSum + swapLast) | 0;

    state = Math.imul((state + x) | 0, a);
    for (const factor of [0xcf98b111, 0x87085b9f, 0x12ceb96d, 0x257e1d83]) {
      state = Math.imul(rotate16(state), factor);
    }
    sum = (sum + state) | 0;
    t = Math.imul((state + y) | 0, b);
    t = Math.imul(rotate16(t), 0xa27416f5);
    t = Math.imul(rotate16(t), 0xd38396ff);
    t = Math.imul(rotate16(t), 0x7c932b89);
    state = Math.imul(rotate16(t), 0xbfa49f69);
    sum = (sum + state) | 0;
  }
  const cs64 = Buffer.alloc(8);
  cs64.writeUInt32LE((swapLast ^ state) >>> 0, 0);
  cs64.writeUInt32LE((swapSum ^ sum) >>> 0, 4);
  return `${cs64.toString("hex")}-${digest.toString("hex")}`.toUpperCase();
}

export function createSynthesisUrl(): string {
  const url = new URL(
    "wss://speech.platform.bing.com/consumer/speech/synthesize/readaloud/edge/v1",
  );
  url.searchParams.set("TrustedClientToken", TRUSTED_CLIENT_TOKEN);
  url.searchParams.set("Sec-MS-GEC", generateSecMsGec());
  url.searchParams.set("Sec-MS-GEC-Version", SEC_MS_GEC_VERSION);
  url.searchParams.set("ConnectionId", randomUUID().replaceAll("-", ""));
  return url.toString();
}
