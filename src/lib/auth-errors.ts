type AuthLikeError = {
  code?: string;
  error_code?: string;
  message?: string;
  status?: number;
  name?: string;
};

export function isThrottledAuthError(error: unknown) {
  const e = error as AuthLikeError;
  const code = e?.code ?? e?.error_code ?? "";
  const message = e?.message ?? "";
  return e?.status === 429 || /rate|throttl|too_many|over_request/i.test(`${code} ${message}`);
}

export function formatAuthError(error: unknown, fallback = "Authentication failed") {
  const e = error as AuthLikeError;
  const code = e?.code ?? e?.error_code;
  const message = e?.message ?? fallback;
  const prefix = [e?.status ? `[${e.status}]` : null, code ? `(${code})` : null].filter(Boolean).join(" ");

  const detail = isThrottledAuthError(error)
    ? `Too many attempts. ${message}`
    : code === "weak_password"
      ? `${message} Use a unique password that has not appeared in a data breach.`
      : message;

  return [prefix, detail].filter(Boolean).join(" ");
}

export function logAuthError(scope: string, error: unknown) {
  const e = error as AuthLikeError;
  console.error(scope, {
    name: e?.name,
    status: e?.status,
    code: e?.code ?? e?.error_code,
    message: e?.message,
  });
}