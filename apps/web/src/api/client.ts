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

async function fetchWithTimeout(
  input: RequestInfo | URL,
  init?: RequestInit,
  timeoutMs = DEFAULT_API_TIMEOUT_MS,
): Promise<Response> {
  const controller = new AbortController();
  const onAbort = () => controller.abort(init?.signal?.reason);
  if (init?.signal?.aborted) {
    onAbort();
  } else {
    init?.signal?.addEventListener("abort", onAbort, { once: true });
  }
  const timer = setTimeout(
    () => controller.abort(new DOMException("Request timed out", "TimeoutError")),
    timeoutMs,
  );
  try {
    return await fetch(input, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timer);
    init?.signal?.removeEventListener("abort", onAbort);
  }
}

export async function fetchHealth(signal?: AbortSignal): Promise<HealthResponse> {
  const response = await fetchWithTimeout("/api/health", signal ? { signal } : undefined);
  if (!response.ok) {
    throw new ApiHttpError(response.status, `Health check failed with status ${response.status}`);
  }
  const data: unknown = await response.json();
  return HealthResponseSchema.parse(data);
}

export async function fetchVoices(
  apiKey?: string,
  signal?: AbortSignal,
): Promise<readonly VoiceDto[]> {
  const headers = createAuthorizationHeaders(apiKey);
  const response = await fetchWithTimeout(
    "/api/voices",
    signal ? { headers, signal } : { headers },
  );
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

  const response = await fetchWithTimeout("/api/speech", {
    method: "POST",
    headers,
    body: JSON.stringify(request),
    signal,
  });

  return response;
}
