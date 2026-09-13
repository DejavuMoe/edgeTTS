import {
  type HealthResponse,
  HealthResponseSchema,
  type NativeSpeechRequest,
  type VoiceDto,
  VoicesResponseSchema,
} from "@edgetts/shared";

export async function fetchHealth(): Promise<HealthResponse> {
  const response = await fetch("/api/health");
  if (!response.ok) {
    throw new Error(`Health check failed with status ${response.status}`);
  }
  const data: unknown = await response.json();
  return HealthResponseSchema.parse(data);
}

export async function fetchVoices(): Promise<readonly VoiceDto[]> {
  const response = await fetch("/api/voices");
  if (!response.ok) {
    throw new Error(`Failed to fetch voices with status ${response.status}`);
  }
  const data: unknown = await response.json();
  const parsed = VoicesResponseSchema.parse(data);
  return parsed.voices;
}

export async function synthesizeSpeech(
  request: NativeSpeechRequest,
  signal: AbortSignal,
): Promise<Response> {
  const response = await fetch("/api/speech", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify(request),
    signal,
  });

  return response;
}
