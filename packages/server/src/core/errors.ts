import type { ApiError, ErrorCode } from '@ttfolio/shared';

/** 业务错误：code 必须取自 shared 的错误码枚举（ERR-1 / C-33）。 */
export class AppError extends Error {
  readonly code: ErrorCode;
  readonly detail?: ApiError['detail'];
  readonly httpStatus: number;

  constructor(code: ErrorCode, message: string, detail?: ApiError['detail'], httpStatus?: number) {
    super(message);
    this.name = 'AppError';
    this.code = code;
    this.detail = detail;
    this.httpStatus = httpStatus ?? defaultHttpStatus(code);
  }
}

/** 错误码 → 默认 HTTP 状态（导出给统一响应钩子复用，避免两处映射漂移）。 */
export function defaultHttpStatus(code: ErrorCode): number {
  switch (code) {
    case 'NOT_FOUND':
      return 404;
    case 'PATH_OUT_OF_SCOPE':
    case 'INVALID_NAME':
    case 'CONFIRM_REQUIRED':
    case 'IS_DIRECTORY':
    case 'BAD_REQUEST':
      return 400;
    case 'MTIME_CONFLICT':
    case 'REV_CONFLICT':
    case 'DUPLICATE_PROJECT':
      return 409;
    case 'GIT_UNAVAILABLE':
    case 'ENCODING_UNSUPPORTED':
    case 'TOO_LARGE':
      return 415;
    case 'GIT_IN_PROGRESS':
    case 'GIT_DIRTY':
      return 422;
    case 'PERMISSION_DENIED':
      return 403;
    case 'CANCELLED':
      return 499;
    default:
      return 500;
  }
}

/** 判断是否Node 系统错误中的"无权限/占用"类 */
export function isErrnoException(e: unknown): e is NodeJS.ErrnoException {
  return (
    typeof e === 'object' && e !== null && 'code' in e && typeof (e as { code?: unknown }).code === 'string'
  );
}
