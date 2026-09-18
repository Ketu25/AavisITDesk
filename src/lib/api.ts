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

  // Not every response that reaches here is JSON — a gateway timeout, a
  // Cloudflare error page, or anything else that answers in HTML would
  // otherwise throw a bare SyntaxError out of this helper, past every
  // `instanceof ApiClientError` check in the app, and surface as the generic
  // "please try again" that tells the user nothing.
  let payload: Record<string, unknown> = {};
  if (text) {
    try {
      payload = JSON.parse(text) as Record<string, unknown>;
    } catch {
      throw new ApiClientError(
        response.ok
          ? "The server sent a response this app could not read."
          : `Request failed (${response.status})`,
        response.status,
      );
    }
  }

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
