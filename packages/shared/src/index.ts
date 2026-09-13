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

export const SpeechRequestSchema = z
  .object({
    model: z.enum(["tts-1", "tts-1-hd"]),
    voice: z.string().refine((val) => val.trim().length > 0, {
      message: "Voice must not be empty",
    }),
    input: z
      .string()
      .min(1)
      .max(4096)
      .refine((val) => val.trim().length > 0, {
        message: "Input must not be empty or whitespace only",
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

export const OpenAiSpeechRequestSchema = SpeechRequestSchema;
export type OpenAiSpeechRequest = SpeechRequest;
