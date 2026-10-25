import type { Kopecks } from '../domain/money.ts';
import { archiveAccount, balancesByAccount, deleteAccount } from '../domain/model/accounts.ts';
import { hideCategory, seedCategories } from '../domain/model/categories.ts';
import { validateOperation } from '../domain/model/operations.ts';
import type {
  Account,
  AccountType,
  Category,
  CategoryKind,
  Contour,
  IsoDate,
  Operation,
  PayerKind,
} from '../domain/model/types.ts';
import { isFirstRun, type LedgerRepository, type LedgerSnapshot } from '../storage/repository.ts';

export interface Clock {
  now(): Date;
}

export const systemClock: Clock = { now: () => new Date() };

export type IdFactory = () => string;

export const randomId: IdFactory = () =>
  globalThis.crypto?.randomUUID?.() ?? `id-${Math.random().toString(36).slice(2)}-${Date.now()}`;

export function today(clock: Clock): IsoDate {
  // Локальная дата, а не UTC: трата в 2 часа ночи должна попасть в сегодня
  // по часам пользователя, иначе отчёт за месяц разъедется на границе.
  const date = clock.now();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${date.getFullYear()}-${month}-${day}`;
}

export interface NewExpense {
  amount: Kopecks;
  categoryId: string;
  accountId: string;
  contour: Contour;
  date?: IsoDate;
  note?: string;
}

export interface NewIncome extends NewExpense {
  payerKind?: PayerKind;
}

export interface NewTransfer {
  fromAccountId: string;
  toAccountId: string;
  amount: Kopecks;
  amountReceived?: Kopecks;
  date?: IsoDate;
  note?: string;
}

/**
 * Единственная точка записи данных.
 *
 * Каждая операция проходит через `validateOperation` до попадания в
 * хранилище — инварианты домена нельзя обойти, записав «напрямую в базу».
 * Класс не зависит от React: его можно тестировать и переиспользовать,
 * например в Telegram-боте третьего этапа.
 */
export class LedgerService {
  private snapshot: LedgerSnapshot = { accounts: [], categories: [], operations: [] };

  // Поля объявлены явно, а не через parameter properties: Node в strip-only
  // режиме их не поддерживает, а домен и сервис тестируются без сборки.
  private readonly repository: LedgerRepository;
  private readonly clock: Clock;
  private readonly makeId: IdFactory;

  constructor(
    repository: LedgerRepository,
    clock: Clock = systemClock,
    makeId: IdFactory = randomId,
  ) {
    this.repository = repository;
    this.clock = clock;
    this.makeId = makeId;
  }

  get state(): LedgerSnapshot {
    return this.snapshot;
  }

  async init(): Promise<LedgerSnapshot> {
    this.snapshot = await this.repository.load();
    if (isFirstRun(this.snapshot)) {
      await this.seedFirstRun();
      this.snapshot = await this.repository.load();
    }
    return this.snapshot;
  }

  /**
   * Стартовый набор: карта, наличные и счёт ИП плюс два набора категорий.
   * Пустой экран на первом запуске — верный способ потерять пользователя,
   * поэтому вести учёт можно сразу, ничего не настраивая.
   */
  private async seedFirstRun(): Promise<void> {
    const now = this.timestamp();
    const accounts: Account[] = [
      this.makeAccount('Карта', 'card', 'personal', now),
      this.makeAccount('Наличные', 'cash', 'personal', now),
      this.makeAccount('Счёт ИП', 'business', 'business', now),
    ];
    const categories = seedCategories(now, () => this.makeId());
    await this.repository.putAccounts(accounts);
    await this.repository.putCategories(categories);
  }

  private makeAccount(
    name: string,
    type: AccountType,
    defaultContour: Contour,
    now: string,
  ): Account {
    return {
      id: this.makeId(),
      name,
      type,
      currency: 'RUB',
      initialBalance: 0,
      defaultContour,
      archived: false,
      updatedAt: now,
    };
  }

  private timestamp(): string {
    return this.clock.now().toISOString();
  }

  private context() {
    return {
      accounts: new Map(this.snapshot.accounts.map((item) => [item.id, item])),
      categories: new Map(this.snapshot.categories.map((item) => [item.id, item])),
    };
  }

  private async commit(operation: Operation): Promise<Operation> {
    validateOperation(operation, this.context());
    await this.repository.putOperation(operation);
    this.snapshot = {
      ...this.snapshot,
      operations: [...this.snapshot.operations.filter((o) => o.id !== operation.id), operation],
    };
    return operation;
  }

  async addExpense(input: NewExpense): Promise<Operation> {
    const now = this.timestamp();
    return this.commit({
      id: this.makeId(),
      kind: 'expense',
      date: input.date ?? today(this.clock),
      amount: input.amount,
      accountId: input.accountId,
      categoryId: input.categoryId,
      contour: input.contour,
      note: input.note,
      createdAt: now,
      updatedAt: now,
    });
  }

  async addIncome(input: NewIncome): Promise<Operation> {
    const now = this.timestamp();
    return this.commit({
      id: this.makeId(),
      kind: 'income',
      date: input.date ?? today(this.clock),
      amount: input.amount,
      accountId: input.accountId,
      categoryId: input.categoryId,
      contour: input.contour,
      payerKind: input.payerKind,
      note: input.note,
      createdAt: now,
      updatedAt: now,
    });
  }

  async addTransfer(input: NewTransfer): Promise<Operation> {
    const now = this.timestamp();
    return this.commit({
      id: this.makeId(),
      kind: 'transfer',
      date: input.date ?? today(this.clock),
      amount: input.amount,
      amountReceived: input.amountReceived ?? input.amount,
      fromAccountId: input.fromAccountId,
      toAccountId: input.toAccountId,
      note: input.note,
      createdAt: now,
      updatedAt: now,
    });
  }

  /**
   * Пересчёт наличных: вместо правки остатка создаём операцию «расхождение».
   * По решению от 25.10.2026 оно не попадает в отчёт расходов по категориям:
   * «я не знаю, куда делись 300 ₽» честнее, чем приписать их к прочему.
   */
  async reconcileCash(accountId: string, countedBalance: Kopecks): Promise<Operation | undefined> {
    const account = this.snapshot.accounts.find((item) => item.id === accountId);
    if (!account) return undefined;
    const current = balancesByAccount(this.snapshot.accounts, this.snapshot.operations).get(
      accountId,
    );
    const delta = countedBalance - (current ?? 0);
    if (delta === 0) return undefined;

    const now = this.timestamp();
    return this.commit({
      id: this.makeId(),
      kind: 'adjustment',
      date: today(this.clock),
      amount: Math.abs(delta),
      delta,
      accountId,
      note: delta > 0 ? 'Излишек при пересчёте' : 'Недостача при пересчёте',
      createdAt: now,
      updatedAt: now,
    });
  }

  /** Мягкое удаление: запись остаётся для журнала и для синхронизации. */
  async removeOperation(id: string): Promise<void> {
    const operation = this.snapshot.operations.find((item) => item.id === id);
    if (!operation) return;
    const now = this.timestamp();
    const removed = { ...operation, deletedAt: now, updatedAt: now };
    await this.repository.putOperation(removed);
    this.snapshot = {
      ...this.snapshot,
      operations: this.snapshot.operations.map((item) => (item.id === id ? removed : item)),
    };
  }

  /** Отмена сразу после сохранения — требование быстрого ввода. */
  async undoRemove(id: string): Promise<void> {
    const operation = this.snapshot.operations.find((item) => item.id === id);
    if (!operation) return;
    const restored = { ...operation, updatedAt: this.timestamp() };
    delete restored.deletedAt;
    await this.repository.putOperation(restored);
    this.snapshot = {
      ...this.snapshot,
      operations: this.snapshot.operations.map((item) => (item.id === id ? restored : item)),
    };
  }

  async addAccount(
    name: string,
    type: AccountType,
    defaultContour: Contour,
    initialBalance: Kopecks = 0,
  ): Promise<Account> {
    const account = {
      ...this.makeAccount(name, type, defaultContour, this.timestamp()),
      initialBalance,
    };
    await this.repository.putAccount(account);
    this.snapshot = { ...this.snapshot, accounts: [...this.snapshot.accounts, account] };
    return account;
  }

  async archiveAccount(id: string): Promise<void> {
    const account = this.snapshot.accounts.find((item) => item.id === id);
    if (!account) return;
    const updated = archiveAccount(account, this.timestamp());
    await this.repository.putAccount(updated);
    this.replaceAccount(updated);
  }

  /** Бросает DomainError, если по счёту есть операции — тогда только архив. */
  async deleteAccount(id: string): Promise<void> {
    const account = this.snapshot.accounts.find((item) => item.id === id);
    if (!account) return;
    const updated = deleteAccount(account, this.snapshot.operations, this.timestamp());
    await this.repository.putAccount(updated);
    this.replaceAccount(updated);
  }

  async addCategory(
    name: string,
    kind: CategoryKind,
    contour: Contour,
    icon = '•',
    color = '#546E7A',
  ): Promise<Category> {
    const category: Category = {
      id: this.makeId(),
      name,
      kind,
      contour,
      icon,
      color,
      hidden: false,
      sortOrder: this.snapshot.categories.length,
      updatedAt: this.timestamp(),
    };
    await this.repository.putCategory(category);
    this.snapshot = { ...this.snapshot, categories: [...this.snapshot.categories, category] };
    return category;
  }

  async hideCategory(id: string): Promise<void> {
    const category = this.snapshot.categories.find((item) => item.id === id);
    if (!category) return;
    const updated = hideCategory(category, this.timestamp());
    await this.repository.putCategory(updated);
    this.snapshot = {
      ...this.snapshot,
      categories: this.snapshot.categories.map((item) => (item.id === id ? updated : item)),
    };
  }

  private replaceAccount(account: Account): void {
    this.snapshot = {
      ...this.snapshot,
      accounts: this.snapshot.accounts.map((item) => (item.id === account.id ? account : item)),
    };
  }
}
