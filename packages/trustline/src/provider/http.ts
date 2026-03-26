export interface WebHandler {
  handle(request: Request): Promise<Response>;
}

export function createHeaders(headers: Record<string, unknown>): Headers {
  const normalized = new Headers();
  for (const [key, value] of Object.entries(headers)) {
    if (typeof value === "string") {
      normalized.set(key, value);
    }

    if (Array.isArray(value)) {
      normalized.set(key, value.join(", "));
    }
  }
  return normalized;
}

export function serializeRequestBody(body: unknown): string | undefined {
  if (typeof body === "string") {
    return body;
  }

  if (!body || typeof body !== "object") {
    return undefined;
  }

  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(body)) {
    if (value === undefined || value === null) {
      continue;
    }

    if (Array.isArray(value)) {
      for (const item of value) {
        params.append(key, String(item));
      }
      continue;
    }

    params.set(key, String(value));
  }

  return params.toString();
}

export async function writeFastifyResponse(
  reply: {
    code(status: number): void;
    header(name: string, value: string): void;
    send(payload: string): void;
  },
  response: Response,
): Promise<void> {
  reply.code(response.status);
  response.headers.forEach((value, key) => {
    reply.header(key, value);
  });
  reply.send(await response.text());
}
