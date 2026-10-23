import type { Kopecks } from '../money.ts';

/**
 * Контур — ядро продукта. Обязательный атрибут каждой операции и каждой
 * категории. Конкуренты эту фичу почти не закрывают (21% покрытия рынка),
 * поэтому она заложена в схему с первого дня, а не добавлена сверху.
 */
export type Contour = 'personal' | 'business';

export type AccountId = string;
export type CategoryId = string;
export type OperationId = string;

/** ISO-дата без времени: 2026-10-23. Время трате не нужно, а часовые пояса ломают отчёты. */
export type IsoDate = string;
/** Отметка времени изменения — для разрешения конфликтов офлайн-синхронизации. */
export type IsoTimestamp = string;

export type AccountType =
  | 'card' // карта
  | 'cash' // наличные
  | 'business' // расчётный счёт ИП
  | 'savings'; // накопительный

export interface Account {
  id: AccountId;
  name: string;
  type: AccountType;
  /** ISO 4217. Мультивалютность — фича второго этапа, но поле нужно сразу. */
  currency: string;
  /** Остаток на момент начала учёта. Текущий остаток всегда вычисляется. */
  initialBalance: Kopecks;
  /** Контур по умолчанию — подставляется в новую операцию по этому счёту. */
  defaultContour: Contour;
  /** Архивный счёт не предлагается в вводе, но его операции остаются в истории. */
  archived: boolean;
  updatedAt: IsoTimestamp;
  deletedAt?: IsoTimestamp;
}

export type CategoryKind = 'expense' | 'income';

export interface Category {
  id: CategoryId;
  name: string;
  kind: CategoryKind;
  /** Категория принадлежит контуру: в бизнес-операции личные не предлагаются. */
  contour: Contour;
  icon: string;
  color: string;
  /** Скрытая категория не предлагается, но остаётся в истории. */
  hidden: boolean;
  sortOrder: number;
  updatedAt: IsoTimestamp;
  deletedAt?: IsoTimestamp;
}

/** Кто заплатил — от этого зависит ставка НПД: 4% с физлиц, 6% с организаций. */
export type PayerKind = 'individual' | 'business';

interface OperationBase {
  id: OperationId;
  date: IsoDate;
  /** Сумма всегда положительная; направление задаёт тип операции. */
  amount: Kopecks;
  note?: string;
  createdAt: IsoTimestamp;
  updatedAt: IsoTimestamp;
  deletedAt?: IsoTimestamp;
}

export interface ExpenseOperation extends OperationBase {
  kind: 'expense';
  accountId: AccountId;
  categoryId: CategoryId;
  contour: Contour;
}

export interface IncomeOperation extends OperationBase {
  kind: 'income';
  accountId: AccountId;
  categoryId: CategoryId;
  contour: Contour;
  /** Обязателен для бизнес-дохода: без него НПД посчитать нельзя. */
  payerKind?: PayerKind;
}

export interface TransferOperation extends OperationBase {
  kind: 'transfer';
  fromAccountId: AccountId;
  toAccountId: AccountId;
  /**
   * Сколько зачислено на счёт получателя. Отличается от `amount` только при
   * переводе между валютами — тогда курс фиксируется в самой операции.
   */
  amountReceived: Kopecks;
}

/**
 * Корректировка остатка — обычно пересчёт наличных.
 * Не правит остаток молча: расхождение всегда остаётся видимой операцией,
 * иначе теряется доверие к цифре.
 */
export interface AdjustmentOperation extends OperationBase {
  kind: 'adjustment';
  accountId: AccountId;
  /** Знак задаёт направление: излишек или недостача. */
  delta: Kopecks;
}

export type Operation =
  | ExpenseOperation
  | IncomeOperation
  | TransferOperation
  | AdjustmentOperation;

export interface AccountEffect {
  accountId: AccountId;
  delta: Kopecks;
}
