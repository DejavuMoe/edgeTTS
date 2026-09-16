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

export const DEFAULT_API_TIMEOUT_MS = 10_000;

function createAuthorizationHeaders(apiKey?: string): Record<string, string> {
  const headers: Record<string, string> = {};
  if (apiKey) {
    headers["Authorization"] = `Bearer ${apiKey}`;
  }
  return headers;
}

async function fetchWithTimeout<T>(
  input: RequestInfo | URL,
  init: RequestInit,
  consume: (response: Response) => Promise<T>,
  timeoutMs = DEFAULT_API_TIMEOUT_MS,
): Promise<T> {
  const controller = new AbortController();
  const signal = init.signal
    ? AbortSignal.any([init.signal, controller.signal])
    : controller.signal;
  const timer = setTimeout(
    () => controller.abort(new DOMException("Request timed out", "TimeoutError")),
    timeoutMs,
  );
  try {
    return await consume(await fetch(input, { ...init, signal }));
  } finally {
    clearTimeout(timer);
  }
}

export async function fetchHealth(signal?: AbortSignal): Promise<HealthResponse> {
  return fetchWithTimeout("/api/health", signal ? { signal } : {}, async (response) => {
    if (!response.ok) {
      throw new ApiHttpError(response.status, `Health check failed with status ${response.status}`);
    }
    const data: unknown = await response.json();
    return HealthResponseSchema.parse(data);
  });
}

export async function fetchVoices(
  apiKey?: string,
  signal?: AbortSignal,
): Promise<readonly VoiceDto[]> {
  const headers = createAuthorizationHeaders(apiKey);
  return fetchWithTimeout(
    "/api/voices",
    signal ? { headers, signal } : { headers },
    async (response) => {
      if (!response.ok) {
        throw new ApiHttpError(
          response.status,
          `Failed to fetch voices with status ${response.status}`,
        );
      }
      const data: unknown = await response.json();
      return VoicesResponseSchema.parse(data).voices;
    },
  );
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

  return fetchWithTimeout(
    "/api/speech",
    {
      method: "POST",
      headers,
      body: JSON.stringify(request),
      signal,
    },
    async (response) => response,
    45_000,
  );
}
