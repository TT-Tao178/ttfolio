/** 统一错误码枚举（C-33）：所有接口失败响应的 code 必须取自这里。 */
export const ERROR_CODES = [
  'PATH_OUT_OF_SCOPE',
  'INVALID_NAME',
  'NOT_FOUND',
  /** 把目录当文件读写（原先直接漏出 Node 的 EISDIR 原始错误，用户看不懂） */
  'IS_DIRECTORY',
  'DUPLICATE_PROJECT',
  'MTIME_CONFLICT',
  'REV_CONFLICT',
  'CONFIRM_REQUIRED',
  'TOO_LARGE',
  'ENCODING_UNSUPPORTED',
  'GIT_UNAVAILABLE',
  'NOT_A_REPO',
  'GIT_IN_PROGRESS',
  'GIT_DIRTY',
  /** 无已暂存内容时提交（原先 git 退出码 1 落入 IO_ERROR 500，语义不清） */
  'NO_STAGED',
  'PERMISSION_DENIED',
  'IO_ERROR',
  'TRASH_PATH_TAKEN',
  'CANCELLED',
  'BAD_REQUEST',
  'INTERNAL',
] as const;

export type ErrorCode = (typeof ERROR_CODES)[number];

export interface ApiError {
  code: ErrorCode;
  message: string;
  detail?: unknown;
}

export type ApiResponse<T> = { ok: true; data: T } | { ok: false; error: ApiError };
