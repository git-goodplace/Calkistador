import type { Kopecks } from '../money.ts';
import { domainError } from './errors.ts';
import type {
  Account,
  AccountEffect,
  Category,
  Contour,
  ExpenseOperation,
  IncomeOperation,
  Operation,
  TransferOperation,
} from './types.ts';

/** Удалённые операции не участвуют ни в остатках, ни в отчётах. */
export function isLive(operation: Operation): boolean {
  return operation.deletedAt === undefined;
}

/**
 * Как операция меняет остатки счетов.
 * Единственное место, где задано направление движения денег.
 */
export function effectsOf(operation: Operation): AccountEffect[] {
  switch (operation.kind) {
    case 'expense':
      return [{ accountId: operation.accountId, delta: -operation.amount }];
    case 'income':
      return [{ accountId: operation.accountId, delta: operation.amount }];
    case 'transfer':
      return [
        { accountId: operation.fromAccountId, delta: -operation.amount },
        { accountId: operation.toAccountId, delta: operation.amountReceived },
      ];
    case 'adjustment':
      return [{ accountId: operation.accountId, delta: operation.delta }];
  }
}

/**
 * Попадает ли операция в отчёт о расходах.
 *
 * Переводы — нет: иначе перевод с личной карты на счёт ИП удвоит и расход,
 * и доход, и все отчёты станут врать. Это та самая фича «переводы без
 * искажения отчётов», и она живёт здесь, а не в коде отчётов.
 *
 * Корректировки — тоже нет: расхождение по наличным не трата, а исправление
 * учёта. В остатке оно есть, в расходах по категориям его быть не должно.
 */
export function countsAsExpense(operation: Operation): operation is ExpenseOperation {
  return operation.kind === 'expense';
}

export function countsAsIncome(operation: Operation): operation is IncomeOperation {
  return operation.kind === 'income';
}

/**
 * Перевод между контурами — «вывел себе зарплату».
 * Определяется по контурам счетов, а не хранится полем: хранимый флаг
 * разъехался бы со счётом после его правки.
 */
export function isContourTransfer(
  operation: TransferOperation,
  accounts: ReadonlyMap<string, Account>,
): boolean {
  const from = accounts.get(operation.fromAccountId);
  const to = accounts.get(operation.toAccountId);
  if (!from || !to) return false;
  return from.defaultContour !== to.defaultContour;
}

export interface OperationContext {
  accounts: ReadonlyMap<string, Account>;
  categories: ReadonlyMap<string, Category>;
}

/**
 * Проверки, без которых данные протухают молча.
 * Вызывается перед записью операции в хранилище.
 */
export function validateOperation(operation: Operation, context: OperationContext): void {
  if (operation.amount <= 0 && operation.kind !== 'adjustment') {
    throw domainError('AMOUNT_NOT_POSITIVE', 'Сумма операции должна быть больше нуля');
  }

  if (operation.kind === 'transfer') {
    if (operation.fromAccountId === operation.toAccountId) {
      throw domainError('TRANSFER_SAME_ACCOUNT', 'Перевод на тот же счёт не имеет смысла');
    }
    requireAccount(operation.fromAccountId, context);
    requireAccount(operation.toAccountId, context);
    if (operation.amountReceived <= 0) {
      throw domainError('AMOUNT_NOT_POSITIVE', 'Зачисленная сумма должна быть больше нуля');
    }
    return;
  }

  const account = requireAccount(operation.accountId, context);

  if (operation.kind === 'adjustment') {
    return;
  }

  const category = context.categories.get(operation.categoryId);
  if (!category) {
    throw domainError('UNKNOWN_CATEGORY', 'Категория не найдена');
  }

  if (category.contour !== operation.contour) {
    throw domainError(
      'CATEGORY_CONTOUR_MISMATCH',
      `Категория «${category.name}» относится к другому контуру`,
    );
  }

  const expectedKind = operation.kind === 'expense' ? 'expense' : 'income';
  if (category.kind !== expectedKind) {
    throw domainError(
      'CATEGORY_KIND_MISMATCH',
      `Категория «${category.name}» не подходит для этой операции`,
    );
  }

  // Доход в бизнес-контуре без типа плательщика нельзя обложить НПД:
  // ставка 4% с физлиц и 6% с организаций различается.
  if (operation.kind === 'income' && operation.contour === 'business' && !operation.payerKind) {
    throw domainError(
      'PAYER_KIND_REQUIRED',
      'Для бизнес-дохода укажите, от кого он получен: от физлица или от организации',
    );
  }

  if (account.archived) {
    throw domainError('ACCOUNT_ARCHIVED', `Счёт «${account.name}» в архиве`);
  }
}

function requireAccount(accountId: string, context: OperationContext): Account {
  const account = context.accounts.get(accountId);
  if (!account) {
    throw domainError('UNKNOWN_ACCOUNT', 'Счёт не найден');
  }
  return account;
}

/** Контур по умолчанию для нового ввода — берётся со счёта. */
export function defaultContourFor(account: Account): Contour {
  return account.defaultContour;
}

/** Сумма расходов по живым операциям контура. Основа отчётов второго этапа. */
export function totalExpenses(operations: readonly Operation[], contour?: Contour): Kopecks {
  return operations
    .filter(isLive)
    .filter(countsAsExpense)
    .filter((operation) => contour === undefined || operation.contour === contour)
    .reduce((sum, operation) => sum + operation.amount, 0);
}

export function totalIncome(operations: readonly Operation[], contour?: Contour): Kopecks {
  return operations
    .filter(isLive)
    .filter(countsAsIncome)
    .filter((operation) => contour === undefined || operation.contour === contour)
    .reduce((sum, operation) => sum + operation.amount, 0);
}
