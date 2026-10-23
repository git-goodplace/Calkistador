import type { Kopecks } from '../money.ts';
import { domainError } from './errors.ts';
import { effectsOf, isLive } from './operations.ts';
import type { Account, AccountId, Contour, Operation } from './types.ts';

/**
 * Текущий остаток по счёту.
 *
 * Остаток НИКОГДА не хранится полем. Хранимый остаток рано или поздно
 * разъезжается с историей операций — а это ровно та цифра, по которой
 * пользователь проверяет, можно ли нам верить. Платим пересчётом.
 */
export function balanceOf(account: Account, operations: readonly Operation[]): Kopecks {
  let balance = account.initialBalance;
  for (const operation of operations) {
    if (!isLive(operation)) continue;
    for (const effect of effectsOf(operation)) {
      if (effect.accountId === account.id) {
        balance += effect.delta;
      }
    }
  }
  return balance;
}

/** Остатки по всем счетам за один проход — для главного экрана. */
export function balancesByAccount(
  accounts: readonly Account[],
  operations: readonly Operation[],
): Map<AccountId, Kopecks> {
  const balances = new Map<AccountId, Kopecks>();
  for (const account of accounts) {
    balances.set(account.id, account.initialBalance);
  }
  for (const operation of operations) {
    if (!isLive(operation)) continue;
    for (const effect of effectsOf(operation)) {
      const current = balances.get(effect.accountId);
      if (current === undefined) continue; // операция по удалённому счёту
      balances.set(effect.accountId, current + effect.delta);
    }
  }
  return balances;
}

/** Суммарный остаток, по желанию — только по одному контуру. */
export function totalBalance(
  accounts: readonly Account[],
  operations: readonly Operation[],
  contour?: Contour,
): Kopecks {
  const balances = balancesByAccount(accounts, operations);
  return accounts
    .filter((account) => contour === undefined || account.defaultContour === contour)
    .reduce((sum, account) => sum + (balances.get(account.id) ?? 0), 0);
}

export function hasOperations(accountId: AccountId, operations: readonly Operation[]): boolean {
  return operations.filter(isLive).some((operation) =>
    effectsOf(operation).some((effect) => effect.accountId === accountId),
  );
}

/**
 * Счёт с операциями удалить нельзя — только архивировать.
 * Удаление осиротило бы операции и переписало историю задним числом.
 */
export function archiveAccount(account: Account, now: string): Account {
  return { ...account, archived: true, updatedAt: now };
}

export function deleteAccount(
  account: Account,
  operations: readonly Operation[],
  now: string,
): Account {
  if (hasOperations(account.id, operations)) {
    throw domainError(
      'ACCOUNT_HAS_OPERATIONS',
      `По счёту «${account.name}» есть операции — его можно только архивировать`,
    );
  }
  return { ...account, deletedAt: now, updatedAt: now };
}

/** Счета, доступные для выбора при вводе операции. */
export function selectableAccounts(accounts: readonly Account[]): Account[] {
  return accounts.filter((account) => !account.archived && account.deletedAt === undefined);
}
