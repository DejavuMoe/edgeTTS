import { countCodePoints, MAX_VOICE_ID_LENGTH, VOICE_ID_REGEX } from "@edgetts/tts-core";
import { z } from "zod";

export { countCodePoints, MAX_VOICE_ID_LENGTH, VOICE_ID_REGEX };

export const HealthResponseSchema = z.object({
  status: z.literal("ok"),
});

export type HealthResponse = z.infer<typeof HealthResponseSchema>;

export const VoiceDtoSchema = z.object({
  id: z.string(),
  displayName: z.string(),
  locale: z.string(),
  gender: z.string(),
  status: z.string().optional(),
  suggestedCodec: z.string().optional(),
});

export type VoiceDto = z.infer<typeof VoiceDtoSchema>;

export const VoicesResponseSchema = z.object({
  voices: z.array(VoiceDtoSchema),
});

export type VoicesResponse = z.infer<typeof VoicesResponseSchema>;

export const ApiErrorSchema = z.object({
  error: z.object({
    code: z.string(),
    message: z.string(),
  }),
});

export type ApiError = z.infer<typeof ApiErrorSchema>;

export const VoiceIdSchema = z
  .string()
  .min(1, "Voice must not be empty")
  .max(MAX_VOICE_ID_LENGTH, `Voice must not exceed ${MAX_VOICE_ID_LENGTH} characters`)
  .regex(VOICE_ID_REGEX, "Voice identifier contains invalid characters")
  .describe("Edge voice ID, as listed by GET /api/voices.");

/**
 * A finite number within [min, max]. Native constraints (not a refinement) so that generated
 * JSON Schema carries the bounds.
 */
function boundedNumber(min: number, max: number, message: string) {
  return z.number().finite({ message }).min(min, { message }).max(max, { message });
}

const SpeedSchema = boundedNumber(
  0.5,
  2.0,
  "Speed must be a finite number between 0.5 and 2.0",
).describe("Speaking rate multiplier; 1 is normal speed.");

export const SpeechRequestSchema = z
  .object({
    model: z
      .enum(["tts-1", "tts-1-hd"])
      .describe("tts-1 selects 48 kbps MP3 and tts-1-hd 96 kbps MP3 from Edge, not OpenAI models."),
    voice: VoiceIdSchema,
    input: z
      .string()
      .min(1)
      .max(4096)
      .refine((val) => val.trim().length > 0, {
        message: "Input must not be empty or whitespace only",
      })
      .refine(isValidXmlText, {
        message: "Input contains characters not supported by XML",
      })
      .describe(
        "Text to synthesize: at most 4,096 UTF-16 code units, not whitespace-only, " +
          "and only characters allowed in XML.",
      ),
    response_format: z.literal("mp3").optional().describe("Only mp3 is supported."),
    speed: SpeedSchema.optional(),
  })
  .strict();

export type SpeechRequest = z.infer<typeof SpeechRequestSchema>;

export const MAX_NATIVE_INPUT_CODE_POINTS = 20_000;

export function isValidXmlText(text: string): boolean {
  for (let index = 0; index < text.length;) {
    const codePoint = text.codePointAt(index)!;
    if (
      codePoint !== 0x9 &&
      codePoint !== 0xa &&
      codePoint !== 0xd &&
      (codePoint < 0x20 ||
        (codePoint >= 0xd800 && codePoint <= 0xdfff) ||
        (codePoint > 0xfffd && codePoint < 0x10000))
    ) {
      return false;
    }
    index += codePoint > 0xffff ? 2 : 1;
  }
  return true;
}

export const NativeSpeechRequestSchema = z
  .object({
    input: z
      .string()
      .refine((val) => val.trim().length > 0, {
        message: "Input must not be empty or whitespace only",
      })
      .refine(isValidXmlText, {
        message: "Input contains characters not supported by XML",
      })
      .refine((val) => countCodePoints(val) <= MAX_NATIVE_INPUT_CODE_POINTS, {
        message: `Input must not exceed ${MAX_NATIVE_INPUT_CODE_POINTS} code points`,
      })
      .describe(
        `Text to synthesize: at most ${MAX_NATIVE_INPUT_CODE_POINTS.toLocaleString("en-US")} ` +
          "Unicode code points, not whitespace-only, and only characters allowed in XML.",
      ),
    voice: VoiceIdSchema,
    quality: z
      .enum(["standard", "high"])
      .optional()
      .describe("standard: 48 kbps MP3 (default); high: 96 kbps MP3."),
    speed: SpeedSchema.optional(),
    pitchSemitones: boundedNumber(
      -12,
      12,
      "Pitch must be a finite number between -12 and 12 semitones",
    )
      .describe("Pitch shift in semitones; 0 keeps the voice's pitch.")
      .optional(),
    volume: boundedNumber(0, 1, "Volume must be a finite number between 0 and 1")
      .describe("Output volume from 0 (silent) to 1 (full).")
      .optional(),
  })
  .strict();

export type NativeSpeechRequest = z.infer<typeof NativeSpeechRequestSchema>;
