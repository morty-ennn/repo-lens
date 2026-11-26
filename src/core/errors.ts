export class AnalyzeError extends Error {
  readonly code: string;
  readonly httpStatus: number;
  readonly hint?: string;
  readonly retryable: boolean;
  readonly resetAt: string | null;

  constructor(
    code: string,
    message: string,
    opts: { httpStatus?: number; hint?: string; retryable?: boolean; resetAt?: string | null } = {},
  ) {
    super(message);
    this.name = 'AnalyzeError';
    this.code = code;
    this.httpStatus = opts.httpStatus ?? 500;
    this.hint = opts.hint;
    this.retryable = opts.retryable ?? false;
    this.resetAt = opts.resetAt ?? null;
  }
}
