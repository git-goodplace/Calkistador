/**
 * Коды ошибок домена. Интерфейс показывает текст по коду, а не разбирает
 * сообщение строкой — сообщения меняются, коды нет.
 */
export type DomainErrorCode =
  | 'ACCOUNT_HAS_OPERATIONS'
  | 'CATEGORY_HAS_OPERATIONS'
  | 'CATEGORY_CONTOUR_MISMATCH'
  | 'CATEGORY_KIND_MISMATCH'
  | 'UNKNOWN_ACCOUNT'
  | 'UNKNOWN_CATEGORY'
  | 'AMOUNT_NOT_POSITIVE'
  | 'TRANSFER_SAME_ACCOUNT'
  | 'PAYER_KIND_REQUIRED'
  | 'ACCOUNT_ARCHIVED';

export class DomainError extends Error {
  readonly code: DomainErrorCode;

  constructor(code: DomainErrorCode, message: string) {
    super(message);
    this.name = 'DomainError';
    this.code = code;
  }
}

export function domainError(code: DomainErrorCode, message: string): DomainError {
  return new DomainError(code, message);
}
