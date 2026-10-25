import assert from 'node:assert/strict';
import { test } from 'node:test';

import { rubles } from '../src/domain/money.ts';
import { balancesByAccount, totalBalance } from '../src/domain/model/accounts.ts';
import { selectableCategories } from '../src/domain/model/categories.ts';
import { DomainError } from '../src/domain/model/errors.ts';
import { totalExpenses, totalIncome } from '../src/domain/model/operations.ts';
import { LedgerService, type Clock } from '../src/state/ledger-service.ts';
import { MemoryLedgerRepository } from '../src/storage/memory-repository.ts';

function fixedClock(iso: string): Clock {
  return { now: () => new Date(iso) };
}

function makeService(iso = '2026-10-25T09:30:00.000Z') {
  let counter = 0;
  const repository = new MemoryLedgerRepository();
  const service = new LedgerService(repository, fixedClock(iso), () => `id-${++counter}`);
  return { service, repository };
}

async function started(iso?: string) {
  const { service, repository } = makeService(iso);
  await service.init();
  return { service, repository };
}

function accountNamed(service: LedgerService, name: string) {
  const found = service.state.accounts.find((item) => item.name === name);
  if (!found) throw new Error(`нет счёта «${name}»`);
  return found;
}

function firstCategory(service: LedgerService, contour: 'personal' | 'business', kind: 'expense' | 'income') {
  const list = selectableCategories(service.state.categories, contour, kind);
  if (list.length === 0) throw new Error('нет категорий');
  return list[0];
}

test('первый запуск: счета и категории создаются сразу', async () => {
  const { service } = await started();
  const names = service.state.accounts.map((item) => item.name);
  assert.deepEqual(names, ['Карта', 'Наличные', 'Счёт ИП']);
  assert.equal(service.state.categories.length, 19);
  assert.equal(service.state.operations.length, 0);
  // счёт ИП сразу в бизнес-контуре
  assert.equal(accountNamed(service, 'Счёт ИП').defaultContour, 'business');
});

test('повторный запуск не создаёт второй набор данных', async () => {
  const { service, repository } = makeService();
  await service.init();
  const again = new LedgerService(repository, fixedClock('2026-10-26T09:00:00.000Z'), () => 'x');
  await again.init();
  assert.equal(again.state.accounts.length, 3);
  assert.equal(again.state.categories.length, 19);
});

test('расход сохраняется, попадает в остаток и в расходы', async () => {
  const { service } = await started();
  const card = accountNamed(service, 'Карта');
  const food = firstCategory(service, 'personal', 'expense');

  await service.addExpense({
    amount: rubles(1_250),
    categoryId: food.id,
    accountId: card.id,
    contour: 'personal',
  });

  assert.equal(service.state.operations.length, 1);
  assert.equal(service.state.operations[0].date, '2026-10-25');
  assert.equal(totalExpenses(service.state.operations), rubles(1_250));
  const balances = balancesByAccount(service.state.accounts, service.state.operations);
  assert.equal(balances.get(card.id), rubles(-1_250));
});

test('данные переживают перезапуск: операция читается из хранилища', async () => {
  const { service, repository } = makeService();
  await service.init();
  const card = accountNamed(service, 'Карта');
  const food = firstCategory(service, 'personal', 'expense');
  await service.addExpense({
    amount: rubles(500),
    categoryId: food.id,
    accountId: card.id,
    contour: 'personal',
  });

  const reopened = new LedgerService(repository, fixedClock('2026-10-26T08:00:00.000Z'), () => 'y');
  await reopened.init();
  assert.equal(reopened.state.operations.length, 1);
  assert.equal(totalExpenses(reopened.state.operations), rubles(500));
});

test('бизнес-доход без типа плательщика отклоняется и не попадает в хранилище', async () => {
  const { service, repository } = await started();
  const business = accountNamed(service, 'Счёт ИП');
  const clientPayment = firstCategory(service, 'business', 'income');

  await assert.rejects(
    () =>
      service.addIncome({
        amount: rubles(100_000),
        categoryId: clientPayment.id,
        accountId: business.id,
        contour: 'business',
      }),
    (error: unknown) => {
      assert.ok(error instanceof DomainError);
      assert.equal(error.code, 'PAYER_KIND_REQUIRED');
      return true;
    },
  );

  const stored = await repository.load();
  assert.equal(stored.operations.length, 0);
  assert.equal(service.state.operations.length, 0);
});

test('бизнес-доход с типом плательщика сохраняется', async () => {
  const { service } = await started();
  const business = accountNamed(service, 'Счёт ИП');
  const clientPayment = firstCategory(service, 'business', 'income');

  await service.addIncome({
    amount: rubles(120_000),
    categoryId: clientPayment.id,
    accountId: business.id,
    contour: 'business',
    payerKind: 'business',
  });

  assert.equal(totalIncome(service.state.operations, 'business'), rubles(120_000));
  assert.equal(totalIncome(service.state.operations, 'personal'), 0);
});

test('вывод денег со счёта ИП себе — перевод, а не доход', async () => {
  const { service } = await started();
  const business = accountNamed(service, 'Счёт ИП');
  const card = accountNamed(service, 'Карта');
  const clientPayment = firstCategory(service, 'business', 'income');

  await service.addIncome({
    amount: rubles(200_000),
    categoryId: clientPayment.id,
    accountId: business.id,
    contour: 'business',
    payerKind: 'business',
  });
  await service.addTransfer({
    fromAccountId: business.id,
    toAccountId: card.id,
    amount: rubles(80_000),
  });

  const balances = balancesByAccount(service.state.accounts, service.state.operations);
  assert.equal(balances.get(business.id), rubles(120_000));
  assert.equal(balances.get(card.id), rubles(80_000));
  // перевод не раздул ни доход, ни расход
  assert.equal(totalIncome(service.state.operations), rubles(200_000));
  assert.equal(totalExpenses(service.state.operations), 0);
  assert.equal(totalBalance(service.state.accounts, service.state.operations), rubles(200_000));
});

test('пересчёт наличных создаёт расхождение и не трогает расходы', async () => {
  const { service } = await started();
  const cash = accountNamed(service, 'Наличные');
  const food = firstCategory(service, 'personal', 'expense');

  await service.addTransfer({
    fromAccountId: accountNamed(service, 'Карта').id,
    toAccountId: cash.id,
    amount: rubles(5_000),
  });
  await service.addExpense({
    amount: rubles(1_000),
    categoryId: food.id,
    accountId: cash.id,
    contour: 'personal',
  });

  // в кошельке осталось 3 700, а по учёту должно быть 4 000
  const adjustment = await service.reconcileCash(cash.id, rubles(3_700));
  assert.ok(adjustment);
  assert.equal(adjustment.kind, 'adjustment');

  const balances = balancesByAccount(service.state.accounts, service.state.operations);
  assert.equal(balances.get(cash.id), rubles(3_700));
  // расхождение в расходы по категориям не попало
  assert.equal(totalExpenses(service.state.operations), rubles(1_000));
});

test('пересчёт без расхождения не создаёт лишнюю операцию', async () => {
  const { service } = await started();
  const cash = accountNamed(service, 'Наличные');
  const result = await service.reconcileCash(cash.id, 0);
  assert.equal(result, undefined);
  assert.equal(service.state.operations.length, 0);
});

test('отмена после сохранения убирает операцию из остатка и возвращает обратно', async () => {
  const { service } = await started();
  const card = accountNamed(service, 'Карта');
  const food = firstCategory(service, 'personal', 'expense');
  const operation = await service.addExpense({
    amount: rubles(700),
    categoryId: food.id,
    accountId: card.id,
    contour: 'personal',
  });

  await service.removeOperation(operation.id);
  assert.equal(totalExpenses(service.state.operations), 0);
  // запись не исчезла — она нужна журналу и синхронизации
  assert.equal(service.state.operations.length, 1);

  await service.undoRemove(operation.id);
  assert.equal(totalExpenses(service.state.operations), rubles(700));
});

test('свой счёт и своя категория добавляются и сразу доступны', async () => {
  const { service } = await started();
  const savings = await service.addAccount('Накопления', 'savings', 'personal', rubles(10_000));
  const category = await service.addCategory('Образование', 'expense', 'personal');

  assert.equal(service.state.accounts.length, 4);
  await service.addExpense({
    amount: rubles(3_000),
    categoryId: category.id,
    accountId: savings.id,
    contour: 'personal',
  });
  const balances = balancesByAccount(service.state.accounts, service.state.operations);
  assert.equal(balances.get(savings.id), rubles(7_000));
});

test('счёт с операциями нельзя удалить через сервис', async () => {
  const { service } = await started();
  const card = accountNamed(service, 'Карта');
  const food = firstCategory(service, 'personal', 'expense');
  await service.addExpense({
    amount: rubles(100),
    categoryId: food.id,
    accountId: card.id,
    contour: 'personal',
  });

  await assert.rejects(() => service.deleteAccount(card.id), (error: unknown) => {
    assert.ok(error instanceof DomainError);
    assert.equal(error.code, 'ACCOUNT_HAS_OPERATIONS');
    return true;
  });
});

test('скрытая категория больше не предлагается при вводе', async () => {
  const { service } = await started();
  const food = firstCategory(service, 'personal', 'expense');
  await service.hideCategory(food.id);
  const offered = selectableCategories(service.state.categories, 'personal', 'expense');
  assert.ok(!offered.some((item) => item.id === food.id));
});

test('дата операции берётся по локальным часам пользователя', async () => {
  // 25 октября 23:30 по Москве — это 20:30 UTC; дата должна остаться 25-м
  const { service } = await started('2026-10-25T20:30:00.000Z');
  const card = accountNamed(service, 'Карта');
  const food = firstCategory(service, 'personal', 'expense');
  const operation = await service.addExpense({
    amount: rubles(100),
    categoryId: food.id,
    accountId: card.id,
    contour: 'personal',
  });
  const expected = new Date('2026-10-25T20:30:00.000Z');
  const month = String(expected.getMonth() + 1).padStart(2, '0');
  const day = String(expected.getDate()).padStart(2, '0');
  assert.equal(operation.date, `${expected.getFullYear()}-${month}-${day}`);
});
