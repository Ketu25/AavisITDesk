/** Thin wrapper so every caller surfaces the server's message, not "500". */
export async function api<T = unknown>(
  url: string,
  options: RequestInit & { json?: unknown } = {},
): Promise<T> {
  const { json, ...rest } = options;

  const response = await fetch(url, {
    ...rest,
    headers: {
      ...(json !== undefined ? { "Content-Type": "application/json" } : {}),
      ...rest.headers,
    },
    body: json !== undefined ? JSON.stringify(json) : rest.body,
  });

  const text = await response.text();
  const payload = text ? (JSON.parse(text) as Record<string, unknown>) : {};

  if (!response.ok) {
    const message =
      typeof payload.error === "string" ? payload.error : `Request failed (${response.status})`;
    throw new ApiClientError(message, response.status, payload.details);
  }

  return payload as T;
}

export class ApiClientError extends Error {
  constructor(
    message: string,
    public status: number,
    public details?: unknown,
  ) {
    super(message);
    this.name = "ApiClientError";
  }
}
