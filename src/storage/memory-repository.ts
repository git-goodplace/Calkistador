import type { Account, Category, Operation } from '../domain/model/types.ts';
import type { LedgerRepository, LedgerSnapshot } from './repository.ts';

/**
 * Реализация в памяти. Нужна для тестов: IndexedDB в Node нет, а проверять
 * логику приложения без браузера хочется.
 */
export class MemoryLedgerRepository implements LedgerRepository {
  private accounts = new Map<string, Account>();
  private categories = new Map<string, Category>();
  private operations = new Map<string, Operation>();
  private lastSyncedAt: string | undefined;

  async load(): Promise<LedgerSnapshot> {
    return {
      accounts: [...this.accounts.values()],
      categories: [...this.categories.values()],
      operations: [...this.operations.values()],
    };
  }

  async putAccount(account: Account): Promise<void> {
    this.accounts.set(account.id, account);
  }

  async putCategory(category: Category): Promise<void> {
    this.categories.set(category.id, category);
  }

  async putOperation(operation: Operation): Promise<void> {
    this.operations.set(operation.id, operation);
  }

  async putAccounts(accounts: readonly Account[]): Promise<void> {
    for (const account of accounts) this.accounts.set(account.id, account);
  }

  async putCategories(categories: readonly Category[]): Promise<void> {
    for (const category of categories) this.categories.set(category.id, category);
  }

  async putOperations(operations: readonly Operation[]): Promise<void> {
    for (const operation of operations) this.operations.set(operation.id, operation);
  }

  async getLastSyncedAt(): Promise<string | undefined> {
    return this.lastSyncedAt;
  }

  async setLastSyncedAt(value: string): Promise<void> {
    this.lastSyncedAt = value;
  }
}
