// Thin fetch wrapper for all `/api/*` calls made by the SPA. Every page/
// component should go through `get`/`post`/`patch`/`del` below rather than
// calling `fetch` directly, so auth cookies, JSON parsing, and error
// shape stay consistent across the app.
//
// Actual data-fetching call sites (which endpoint, what payload, how the
// response maps to UI state) are out of scope for this scaffold task — that
// wiring happens page-by-page in the next task.

const API_BASE = "/api";

/** Error thrown by `request()` for any non-2xx response. Carries the
 * server's own error message when the body parsed as JSON with one. */
export class ApiError extends Error {
  status: number;
  body: unknown;

  constructor(message: string, status: number, body: unknown) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.body = body;
  }
}

async function parseBody(res: Response): Promise<unknown> {
  const text = await res.text();
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

function extractErrorMessage(body: unknown, fallback: string): string {
  if (body && typeof body === "object") {
    const b = body as Record<string, unknown>;
    if (typeof b.error === "string") return b.error;
    if (typeof b.message === "string") return b.message;
  }
  return fallback;
}

export interface RequestOptions {
  /** Query params appended to the URL (undefined values are skipped). */
  params?: Record<string, string | number | boolean | undefined>;
  headers?: Record<string, string>;
  signal?: AbortSignal;
}

function buildUrl(path: string, params?: RequestOptions["params"]): string {
  const url = path.startsWith("/") ? `${API_BASE}${path}` : `${API_BASE}/${path}`;
  if (!params) return url;
  const qs = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value === undefined) continue;
    qs.set(key, String(value));
  }
  const query = qs.toString();
  return query ? `${url}?${query}` : url;
}

async function request<T>(
  method: "GET" | "POST" | "PATCH" | "DELETE" | "PUT",
  path: string,
  body?: unknown,
  options?: RequestOptions,
): Promise<T> {
  const res = await fetch(buildUrl(path, options?.params), {
    method,
    credentials: "include",
    headers: {
      ...(body !== undefined ? { "content-type": "application/json" } : {}),
      ...options?.headers,
    },
    body: body !== undefined ? JSON.stringify(body) : undefined,
    signal: options?.signal,
  });

  const parsed = await parseBody(res);

  if (!res.ok) {
    throw new ApiError(
      extractErrorMessage(parsed, `Request failed with status ${res.status}`),
      res.status,
      parsed,
    );
  }

  return parsed as T;
}

export function get<T = unknown>(path: string, options?: RequestOptions): Promise<T> {
  return request<T>("GET", path, undefined, options);
}

export function post<T = unknown>(
  path: string,
  body?: unknown,
  options?: RequestOptions,
): Promise<T> {
  return request<T>("POST", path, body, options);
}

export function patch<T = unknown>(
  path: string,
  body?: unknown,
  options?: RequestOptions,
): Promise<T> {
  return request<T>("PATCH", path, body, options);
}

export function put<T = unknown>(
  path: string,
  body?: unknown,
  options?: RequestOptions,
): Promise<T> {
  return request<T>("PUT", path, body, options);
}

export function del<T = unknown>(path: string, options?: RequestOptions): Promise<T> {
  return request<T>("DELETE", path, undefined, options);
}

export const api = { get, post, patch, put, del };
