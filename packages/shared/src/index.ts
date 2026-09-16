import { z } from "zod";

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

export const MAX_VOICE_ID_LENGTH = 128;
export const VOICE_ID_REGEX = /^[A-Za-z0-9_-]+$/;

export const VoiceIdSchema = z
  .string()
  .min(1, "Voice must not be empty")
  .max(MAX_VOICE_ID_LENGTH, `Voice must not exceed ${MAX_VOICE_ID_LENGTH} characters`)
  .regex(VOICE_ID_REGEX, "Voice identifier contains invalid characters");

export const SpeechRequestSchema = z
  .object({
    model: z.enum(["tts-1", "tts-1-hd"]),
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
      }),
    response_format: z.literal("mp3").optional(),
    speed: z
      .number()
      .refine((val) => Number.isFinite(val) && val >= 0.5 && val <= 2.0, {
        message: "Speed must be a finite number between 0.5 and 2.0",
      })
      .optional(),
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

export function countCodePoints(str: string): number {
  let count = 0;
  for (let i = 0; i < str.length;) {
    const cp = str.codePointAt(i)!;
    i += cp > 0xffff ? 2 : 1;
    count++;
  }
  return count;
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
      }),
    voice: VoiceIdSchema,
    quality: z.enum(["standard", "high"]).optional(),
    speed: z
      .number()
      .refine((val) => Number.isFinite(val) && val >= 0.5 && val <= 2.0, {
        message: "Speed must be a finite number between 0.5 and 2.0",
      })
      .optional(),
    pitchSemitones: z
      .number()
      .refine((val) => Number.isFinite(val) && val >= -12 && val <= 12, {
        message: "Pitch must be a finite number between -12 and 12 semitones",
      })
      .optional(),
    volume: z
      .number()
      .refine((val) => Number.isFinite(val) && val >= 0 && val <= 1, {
        message: "Volume must be a finite number between 0 and 1",
      })
      .optional(),
  })
  .strict();

export type NativeSpeechRequest = z.infer<typeof NativeSpeechRequestSchema>;
