import { rubles } from '../src/domain/money.ts';
import { seedCategories } from '../src/domain/model/categories.ts';
import type {
  Account,
  AdjustmentOperation,
  Category,
  Contour,
  ExpenseOperation,
  IncomeOperation,
  TransferOperation,
} from '../src/domain/model/types.ts';

export const NOW = '2026-10-23T10:00:00.000Z';

export function account(id: string, overrides: Partial<Account> = {}): Account {
  return {
    id,
    name: `Счёт ${id}`,
    type: 'card',
    currency: 'RUB',
    initialBalance: 0,
    defaultContour: 'personal',
    archived: false,
    updatedAt: NOW,
    ...overrides,
  };
}

export function categories(): Category[] {
  return seedCategories(NOW, (seed, index) => `${seed.contour}-${seed.kind}-${index}`);
}

export function findCategory(
  list: readonly Category[],
  contour: Contour,
  kind: 'expense' | 'income',
): Category {
  const found = list.find((item) => item.contour === contour && item.kind === kind);
  if (!found) throw new Error(`нет категории ${contour}/${kind}`);
  return found;
}

export function expense(
  id: string,
  accountId: string,
  categoryId: string,
  amount: number,
  overrides: Partial<ExpenseOperation> = {},
): ExpenseOperation {
  return {
    id,
    kind: 'expense',
    date: '2026-10-20',
    accountId,
    categoryId,
    amount: rubles(amount),
    contour: 'personal',
    createdAt: NOW,
    updatedAt: NOW,
    ...overrides,
  };
}

export function income(
  id: string,
  accountId: string,
  categoryId: string,
  amount: number,
  overrides: Partial<IncomeOperation> = {},
): IncomeOperation {
  return {
    id,
    kind: 'income',
    date: '2026-10-20',
    accountId,
    categoryId,
    amount: rubles(amount),
    contour: 'personal',
    createdAt: NOW,
    updatedAt: NOW,
    ...overrides,
  };
}

export function transfer(
  id: string,
  fromAccountId: string,
  toAccountId: string,
  amount: number,
  overrides: Partial<TransferOperation> = {},
): TransferOperation {
  return {
    id,
    kind: 'transfer',
    date: '2026-10-20',
    fromAccountId,
    toAccountId,
    amount: rubles(amount),
    amountReceived: rubles(amount),
    createdAt: NOW,
    updatedAt: NOW,
    ...overrides,
  };
}

export function adjustment(
  id: string,
  accountId: string,
  delta: number,
): AdjustmentOperation {
  return {
    id,
    kind: 'adjustment',
    date: '2026-10-20',
    accountId,
    amount: Math.abs(rubles(delta)),
    delta: rubles(delta),
    createdAt: NOW,
    updatedAt: NOW,
  };
}
