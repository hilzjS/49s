/**
 * Admin key management for dashboard action buttons.
 *
 * The key is entered by the operator in Settings and stored in
 * localStorage only — it is never committed to source and never
 * sent anywhere except as a header on same-origin /api requests.
 */

const STORAGE_KEY = 'uk49s-admin-key';

export function getAdminKey(): string | null {
  try {
    const v = localStorage.getItem(STORAGE_KEY);
    return v && v.trim() !== '' ? v.trim() : null;
  } catch {
    return null;
  }
}

export function setAdminKey(key: string | null): void {
  try {
    if (key && key.trim() !== '') {
      localStorage.setItem(STORAGE_KEY, key.trim());
    } else {
      localStorage.removeItem(STORAGE_KEY);
    }
  } catch {
    // storage unavailable (private mode) — key just won't persist
  }
}

export class AdminApiError extends Error {
  readonly status: number;
  constructor(message: string, status: number) {
    super(message);
    this.status = status;
  }
}

/** fetch() wrapper that attaches the admin key and surfaces API errors. */
export async function adminFetch<T = unknown>(
  url: string,
  options: RequestInit = {},
): Promise<T> {
  const headers = new Headers(options.headers);
  if (options.body && !headers.has('Content-Type')) {
    headers.set('Content-Type', 'application/json');
  }
  const key = getAdminKey();
  if (key) headers.set('Authorization', `Bearer ${key}`);

  const res = await fetch(url, { ...options, headers });

  let data: unknown = null;
  const text = await res.text();
  if (text) {
    try {
      data = JSON.parse(text);
    } catch {
      data = text;
    }
  }

  if (!res.ok) {
    const msg =
      (typeof data === 'object' && data !== null && 'error' in data && String((data as { error: unknown }).error)) ||
      `Request failed (${res.status})`;
    if (res.status === 401) {
      throw new AdminApiError(
        'Admin key required. Enter it in Settings → Admin API key.',
        401,
      );
    }
    throw new AdminApiError(msg, res.status);
  }

  return data as T;
}
