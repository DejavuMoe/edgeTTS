import {
  type HealthResponse,
  HealthResponseSchema,
  type NativeSpeechRequest,
  type VoiceDto,
  VoicesResponseSchema,
} from "@edgetts/shared";

export class ApiHttpError extends Error {
  readonly status: number;
  constructor(status: number, message: string) {
    super(message);
    this.name = "ApiHttpError";
    this.status = status;
  }
}

function createAuthorizationHeaders(apiKey?: string): Record<string, string> {
  const headers: Record<string, string> = {};
  if (apiKey) {
    headers["Authorization"] = `Bearer ${apiKey}`;
  }
  return headers;
}

export async function fetchHealth(): Promise<HealthResponse> {
  const response = await fetch("/api/health");
  if (!response.ok) {
    throw new ApiHttpError(response.status, `Health check failed with status ${response.status}`);
  }
  const data: unknown = await response.json();
  return HealthResponseSchema.parse(data);
}

export async function fetchVoices(apiKey?: string): Promise<readonly VoiceDto[]> {
  const headers = createAuthorizationHeaders(apiKey);
  const response = await fetch("/api/voices", { headers });
  if (!response.ok) {
    throw new ApiHttpError(
      response.status,
      `Failed to fetch voices with status ${response.status}`,
    );
  }
  const data: unknown = await response.json();
  const parsed = VoicesResponseSchema.parse(data);
  return parsed.voices;
}

export async function synthesizeSpeech(
  request: NativeSpeechRequest,
  signal: AbortSignal,
  apiKey?: string,
): Promise<Response> {
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    ...createAuthorizationHeaders(apiKey),
  };

  const response = await fetch("/api/speech", {
    method: "POST",
    headers,
    body: JSON.stringify(request),
    signal,
  });

  return response;
}
