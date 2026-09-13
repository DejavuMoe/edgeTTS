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
