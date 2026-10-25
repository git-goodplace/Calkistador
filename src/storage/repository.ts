import type { Account, Category, Operation } from '../domain/model/types.ts';

/**
 * Хранилище данных. Домен о нём ничего не знает, а интерфейс — ничего о Dexie.
 *
 * Два смысла у этого разделения:
 *  - тесты работают на реализации в памяти, без браузера и IndexedDB;
 *  - когда появится синхронизация с сервером, она встанет за этот же
 *    интерфейс и не потянет за собой переписывание интерфейса приложения.
 */
export interface LedgerSnapshot {
  accounts: Account[];
  categories: Category[];
  operations: Operation[];
}

export interface LedgerRepository {
  /** Всё содержимое за один раз: для локальной базы это дешевле, чем выборки. */
  load(): Promise<LedgerSnapshot>;

  putAccount(account: Account): Promise<void>;
  putCategory(category: Category): Promise<void>;
  putOperation(operation: Operation): Promise<void>;

  putAccounts(accounts: readonly Account[]): Promise<void>;
  putCategories(categories: readonly Category[]): Promise<void>;
  putOperations(operations: readonly Operation[]): Promise<void>;

  /** Когда последний раз успешно синхронизировались. Пока не используется. */
  getLastSyncedAt(): Promise<string | undefined>;
  setLastSyncedAt(value: string): Promise<void>;
}

export function isFirstRun(snapshot: LedgerSnapshot): boolean {
  return snapshot.accounts.length === 0 && snapshot.categories.length === 0;
}
