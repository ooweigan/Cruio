import axios, { type AxiosInstance } from "axios";

let contextId: string | null = null;
let userId: string | null = null;
let accountEpoch = 0;
let lifetime = new AbortController();
let frozen = false;
let onFailure: (reason: string) => void = () => {};

export function getAccountContext() { return contextId; }
export function getAccountUserId() { return userId; }
export function getAccountEpoch() { return accountEpoch; }
export function freezeAccountContext() {
  frozen = true;
  lifetime.abort(new Error("账户正在退出，本次操作已停止"));
}
export function setAccountTransport(context: string | null, user: string | null, handler: typeof onFailure) {
  if (user !== userId) accountEpoch++;
  if (context !== contextId) {
    lifetime.abort(new Error("账户上下文已变化，本次操作已停止"));
    lifetime = new AbortController();
    frozen = false;
  }
  contextId = context;
  userId = user;
  onFailure = handler;
}

function protectedApi(source: string) {
  const url = new URL(source, window.location.href);
  return url.origin === window.location.origin && url.pathname.startsWith("/api/")
    && (!url.pathname.startsWith("/api/account/") || ["/api/account/wallet", "/api/account/redeem"].includes(url.pathname.replace(/\/+$/, ""))) && url.pathname !== "/api/desktop/ready";
}

function observeFailure(data: unknown) {
  const reason = (data as { data?: { reason?: string } } | null)?.data?.reason;
  if (reason === "sessionExpired" || reason === "accountDisabled") onFailure(reason);
}

export function registerAccountTransport(client: AxiosInstance) {
  const request = client.interceptors.request.use(config => {
    if (!protectedApi(client.getUri(config))) return config;
    if (frozen) throw new axios.CanceledError("账户正在退出");
    const expected = config.headers.get("x-cruio-context");
    if (expected && expected !== contextId) throw new axios.CanceledError("账户上下文已变化");
    if (contextId) config.headers.set("x-cruio-context", contextId);
    config.signal = config.signal ? AbortSignal.any([config.signal as AbortSignal, lifetime.signal]) : lifetime.signal;
    return config;
  }, undefined, { synchronous: true });
  const response = client.interceptors.response.use(result => {
    const expected = result.config.headers.get("x-cruio-context");
    if (expected && expected !== contextId) throw new axios.CanceledError("账户上下文已变化");
    return result;
  }, async error => {
    if (axios.isAxiosError(error) && error.response && protectedApi(client.getUri(error.config))) {
      const expected = error.config?.headers.get("x-cruio-context");
      if (!expected || expected === contextId) {
        let data: unknown = error.response.data;
        if (data instanceof Blob) data = await data.text().then(text => JSON.parse(text)).catch(() => null);
        else if (data instanceof ArrayBuffer) { try { data = JSON.parse(new TextDecoder().decode(data)); } catch { data = null; } }
        observeFailure(data);
      }
    }
    throw error;
  });
  return () => { client.interceptors.request.eject(request); client.interceptors.response.eject(response); };
}

export function registerAccountFetch() {
  const originalFetch = window.fetch;
  const accountFetch: (input: RequestInfo | URL, init?: RequestInit) => Promise<Response> = async (input, init) => {
    if (!protectedApi(input instanceof Request ? input.url : String(input))) return originalFetch(input, init);
    if (frozen) throw new Error("账户正在退出");
    const request = new Request(input, init);
    const expected = request.headers.get("x-cruio-context") ?? contextId;
    if (expected !== contextId) throw new Error("账户上下文已变化");
    if (expected) request.headers.set("x-cruio-context", expected);
    const response = await originalFetch(new Request(request, { signal: AbortSignal.any([request.signal, lifetime.signal]) }));
    if (expected !== contextId) throw new Error("账户上下文已变化");
    if (response.status === 401 || response.status === 403) observeFailure(await response.clone().json().catch(() => null));
    return response;
  };
  window.fetch = Object.assign(accountFetch, originalFetch);
  return () => { window.fetch = originalFetch; };
}
