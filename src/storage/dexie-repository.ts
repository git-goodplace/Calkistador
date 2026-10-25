import Dexie, { type EntityTable } from 'dexie';

import type { Account, Category, Operation } from '../domain/model/types.ts';
import type { LedgerRepository, LedgerSnapshot } from './repository.ts';

interface MetaRecord {
  key: string;
  value: string;
}

/**
 * Локальная база в браузере (IndexedDB).
 *
 * Данные не покидают устройство. Это и есть офлайн-first: запись операции не
 * ждёт сети, потому что сети в этой схеме просто нет. Заодно снимается
 * обязательство по 152-ФЗ — пока сервера нет, персональные данные нигде не
 * обрабатываются.
 *
 * Индексы выбраны под запросы приложения: операции почти всегда читаются
 * по дате (история, отчёты) и по счёту (остаток).
 */
class LedgerDatabase extends Dexie {
  accounts!: EntityTable<Account, 'id'>;
  categories!: EntityTable<Category, 'id'>;
  operations!: EntityTable<Operation, 'id'>;
  meta!: EntityTable<MetaRecord, 'key'>;

  constructor() {
    super('calkistador');
    this.version(1).stores({
      accounts: 'id, defaultContour, archived, updatedAt',
      categories: 'id, contour, kind, hidden, updatedAt',
      operations: 'id, date, kind, accountId, categoryId, updatedAt',
      meta: 'key',
    });
  }
}

const LAST_SYNCED_AT = 'lastSyncedAt';

export class DexieLedgerRepository implements LedgerRepository {
  private readonly db = new LedgerDatabase();

  async load(): Promise<LedgerSnapshot> {
    const [accounts, categories, operations] = await Promise.all([
      this.db.accounts.toArray(),
      this.db.categories.toArray(),
      this.db.operations.toArray(),
    ]);
    return { accounts, categories, operations };
  }

  async putAccount(account: Account): Promise<void> {
    await this.db.accounts.put(account);
  }

  async putCategory(category: Category): Promise<void> {
    await this.db.categories.put(category);
  }

  async putOperation(operation: Operation): Promise<void> {
    await this.db.operations.put(operation);
  }

  async putAccounts(accounts: readonly Account[]): Promise<void> {
    await this.db.accounts.bulkPut([...accounts]);
  }

  async putCategories(categories: readonly Category[]): Promise<void> {
    await this.db.categories.bulkPut([...categories]);
  }

  async putOperations(operations: readonly Operation[]): Promise<void> {
    await this.db.operations.bulkPut([...operations]);
  }

  async getLastSyncedAt(): Promise<string | undefined> {
    const record = await this.db.meta.get(LAST_SYNCED_AT);
    return record?.value;
  }

  async setLastSyncedAt(value: string): Promise<void> {
    await this.db.meta.put({ key: LAST_SYNCED_AT, value });
  }
}
