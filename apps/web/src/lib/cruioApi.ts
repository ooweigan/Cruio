export class ApiError extends Error {
  status: number;

  constructor(message: string, status: number) {
    super(message);
    this.status = status;
  }
}

export async function api<T>(path: string, options: RequestInit = {}) {
  const response = await fetch(path, {
    ...options,
    headers: { "content-type": "application/json", ...options.headers },
  });
  const payload = response.status === 204 ? null : await response.json();
  if (!response.ok) throw new ApiError(payload?.message ?? "请求失败。", response.status);
  return payload as T;
}
