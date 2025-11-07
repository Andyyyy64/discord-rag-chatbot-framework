export type BaseError = Error & {
  code: string;
  details?: Record<string, unknown>;
};

/**
 * ベースエラーを作成する
 */
export function createBaseError(
  message: string,
  code = 'INTERNAL_ERROR',
  details?: Record<string, unknown>
): BaseError {
  const error = new Error(message) as BaseError;
  error.name = 'BaseError';
  error.code = code;
  error.details = details;
  return error;
}
