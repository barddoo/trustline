export type AuthErrorCode =
  | "missing_token"
  | "invalid_token"
  | "invalid_issuer"
  | "invalid_audience"
  | "invalid_scope"
  | "invalid_env"
  | "jwks_fetch_failed";

export class AuthError extends Error {
  public readonly code: AuthErrorCode;
  public readonly status: number;
  public readonly cause?: unknown;

  constructor(
    code: AuthErrorCode,
    message: string,
    status: number,
    cause?: unknown,
  ) {
    super(message);
    this.name = "AuthError";
    this.code = code;
    this.status = status;
    this.cause = cause;
  }
}
