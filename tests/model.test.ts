import assert from 'node:assert/strict';
import { test } from 'node:test';

import { rubles } from '../src/domain/money.ts';
import {
  archiveAccount,
  balanceOf,
  balancesByAccount,
  deleteAccount,
  hasOperations,
  selectableAccounts,
  totalBalance,
} from '../src/domain/model/accounts.ts';
import {
  categoriesByRecentUse,
  deleteCategory,
  reassignOperations,
  seedCategories,
  selectableCategories,
} from '../src/domain/model/categories.ts';
import { DomainError } from '../src/domain/model/errors.ts';
import {
  countsAsExpense,
  countsAsIncome,
  effectsOf,
  isContourTransfer,
  totalExpenses,
  totalIncome,
  validateOperation,
} from '../src/domain/model/operations.ts';
import { mergeCollections, syncStateOf } from '../src/domain/model/sync.ts';
import type { Syncable } from '../src/domain/model/sync.ts';
import {
  NOW,
  account,
  adjustment,
  categories,
  expense,
  findCategory,
  income,
  transfer,
} from './helpers.ts';

function context(accounts = [account('a1')], cats = categories()) {
  return {
    accounts: new Map(accounts.map((item) => [item.id, item])),
    categories: new Map(cats.map((item) => [item.id, item])),
  };
}

// --- Счета и остатки -------------------------------------------------------

test('остаток считается из операций, а не хранится', () => {
  const card = account('a1', { initialBalance: rubles(10_000) });
  const cats = categories();
  const food = findCategory(cats, 'personal', 'expense');
  const salary = findCategory(cats, 'personal', 'income');

  const operations = [
    expense('o1', 'a1', food.id, 1_500),
    expense('o2', 'a1', food.id, 500),
    income('o3', 'a1', salary.id, 3_000),
  ];

  assert.equal(balanceOf(card, operations), rubles(11_000));
});

test('удалённая операция не влияет на остаток', () => {
  const card = account('a1', { initialBalance: rubles(1_000) });
  const food = findCategory(categories(), 'personal', 'expense');
  const operations = [
    expense('o1', 'a1', food.id, 400),
    expense('o2', 'a1', food.id, 100, { deletedAt: NOW }),
  ];
  assert.equal(balanceOf(card, operations), rubles(600));
});

test('перевод уменьшает один счёт и увеличивает другой', () => {
  const card = account('a1', { initialBalance: rubles(5_000) });
  const cash = account('a2', { type: 'cash', initialBalance: 0 });
  const operations = [transfer('t1', 'a1', 'a2', 2_000)];

  const balances = balancesByAccount([card, cash], operations);
  assert.equal(balances.get('a1'), rubles(3_000));
  assert.equal(balances.get('a2'), rubles(2_000));
  // Переводы не создают и не уничтожают деньги
  assert.equal(totalBalance([card, cash], operations), rubles(5_000));
});

test('перевод между валютами фиксирует курс в самой операции', () => {
  const rub = account('a1', { initialBalance: rubles(100_000) });
  const usd = account('a2', { currency: 'USD', initialBalance: 0 });
  const operations = [
    transfer('t1', 'a1', 'a2', 90_000, { amountReceived: rubles(1_000) }),
  ];
  const balances = balancesByAccount([rub, usd], operations);
  assert.equal(balances.get('a1'), rubles(10_000));
  assert.equal(balances.get('a2'), rubles(1_000));
});

test('корректировка наличных остаётся видимой операцией', () => {
  const cash = account('a1', { type: 'cash', initialBalance: rubles(5_000) });
  const operations = [adjustment('adj1', 'a1', -300)];
  assert.equal(balanceOf(cash, operations), rubles(4_700));
  assert.equal(effectsOf(operations[0]).length, 1);
  // но в расходы по категориям расхождение не попадает
  assert.equal(countsAsExpense(operations[0]), false);
  assert.equal(totalExpenses(operations), 0);
});

test('итог по контуру считает только счета этого контура', () => {
  const personal = account('a1', { initialBalance: rubles(10_000) });
  const business = account('a2', { defaultContour: 'business', initialBalance: rubles(50_000) });
  const accounts = [personal, business];

  assert.equal(totalBalance(accounts, [], 'personal'), rubles(10_000));
  assert.equal(totalBalance(accounts, [], 'business'), rubles(50_000));
  assert.equal(totalBalance(accounts, []), rubles(60_000));
});

test('счёт с операциями нельзя удалить, только архивировать', () => {
  const card = account('a1');
  const food = findCategory(categories(), 'personal', 'expense');
  const operations = [expense('o1', 'a1', food.id, 100)];

  assert.equal(hasOperations('a1', operations), true);
  assert.throws(() => deleteAccount(card, operations, NOW), (error: unknown) => {
    assert.ok(error instanceof DomainError);
    assert.equal(error.code, 'ACCOUNT_HAS_OPERATIONS');
    return true;
  });

  const archived = archiveAccount(card, NOW);
  assert.equal(archived.archived, true);
  assert.equal(selectableAccounts([archived]).length, 0);
});

test('счёт без операций удаляется', () => {
  const removed = deleteAccount(account('a1'), [], NOW);
  assert.equal(removed.deletedAt, NOW);
});

// --- Контуры ---------------------------------------------------------------

test('перевод между контурами распознаётся по счетам, а не по флагу', () => {
  const personal = account('a1', { defaultContour: 'personal' });
  const business = account('a2', { defaultContour: 'business' });
  const accounts = new Map([personal, business].map((item) => [item.id, item]));

  const withdrawal = transfer('t1', 'a2', 'a1', 50_000); // вывел себе зарплату
  const internal = transfer('t2', 'a1', 'a1', 100);

  assert.equal(isContourTransfer(withdrawal, accounts), true);
  assert.equal(isContourTransfer(internal, accounts), false);
  // и ни один из них не доход и не расход
  assert.equal(countsAsIncome(withdrawal), false);
  assert.equal(countsAsExpense(withdrawal), false);
});

test('вывод денег из бизнеса себе не считается ни доходом, ни расходом', () => {
  const business = account('a1', { defaultContour: 'business', initialBalance: rubles(100_000) });
  const personal = account('a2', { defaultContour: 'personal' });
  const operations = [transfer('t1', 'a1', 'a2', 40_000)];

  assert.equal(totalIncome(operations), 0);
  assert.equal(totalExpenses(operations), 0);
  assert.equal(totalBalance([business, personal], operations), rubles(100_000));
});

test('расходы считаются отдельно по контурам', () => {
  const cats = categories();
  const personalFood = findCategory(cats, 'personal', 'expense');
  const businessAds = findCategory(cats, 'business', 'expense');
  const operations = [
    expense('o1', 'a1', personalFood.id, 1_000),
    expense('o2', 'a2', businessAds.id, 5_000, { contour: 'business' }),
  ];

  assert.equal(totalExpenses(operations, 'personal'), rubles(1_000));
  assert.equal(totalExpenses(operations, 'business'), rubles(5_000));
  assert.equal(totalExpenses(operations), rubles(6_000));
});

// --- Валидация -------------------------------------------------------------

test('категория чужого контура не принимается', () => {
  const cats = categories();
  const businessCategory = findCategory(cats, 'business', 'expense');
  const operation = expense('o1', 'a1', businessCategory.id, 100, { contour: 'personal' });

  assert.throws(() => validateOperation(operation, context([account('a1')], cats)), (e: unknown) => {
    assert.ok(e instanceof DomainError);
    assert.equal(e.code, 'CATEGORY_CONTOUR_MISMATCH');
    return true;
  });
});

test('категория дохода не подходит для расхода', () => {
  const cats = categories();
  const salary = findCategory(cats, 'personal', 'income');
  const operation = expense('o1', 'a1', salary.id, 100);

  assert.throws(() => validateOperation(operation, context([account('a1')], cats)), (e: unknown) => {
    assert.ok(e instanceof DomainError);
    assert.equal(e.code, 'CATEGORY_KIND_MISMATCH');
    return true;
  });
});

test('бизнес-доход без типа плательщика не принимается: без него НПД не посчитать', () => {
  const cats = categories();
  const clientPayment = findCategory(cats, 'business', 'income');
  const businessAccount = account('a1', { defaultContour: 'business' });
  const operation = income('o1', 'a1', clientPayment.id, 100_000, { contour: 'business' });

  assert.throws(
    () => validateOperation(operation, context([businessAccount], cats)),
    (e: unknown) => {
      assert.ok(e instanceof DomainError);
      assert.equal(e.code, 'PAYER_KIND_REQUIRED');
      return true;
    },
  );

  const fixed = { ...operation, payerKind: 'business' as const };
  assert.doesNotThrow(() => validateOperation(fixed, context([businessAccount], cats)));
});

test('личный доход тип плательщика не требует', () => {
  const cats = categories();
  const salary = findCategory(cats, 'personal', 'income');
  const operation = income('o1', 'a1', salary.id, 50_000);
  assert.doesNotThrow(() => validateOperation(operation, context([account('a1')], cats)));
});

test('нулевая и отрицательная сумма не принимаются', () => {
  const cats = categories();
  const food = findCategory(cats, 'personal', 'expense');
  for (const amount of [0, -100]) {
    const operation = expense('o1', 'a1', food.id, amount);
    assert.throws(() => validateOperation(operation, context([account('a1')], cats)), (e: unknown) => {
      assert.ok(e instanceof DomainError);
      assert.equal(e.code, 'AMOUNT_NOT_POSITIVE');
      return true;
    });
  }
});

test('перевод на тот же счёт не принимается', () => {
  const operation = transfer('t1', 'a1', 'a1', 100);
  assert.throws(() => validateOperation(operation, context()), (e: unknown) => {
    assert.ok(e instanceof DomainError);
    assert.equal(e.code, 'TRANSFER_SAME_ACCOUNT');
    return true;
  });
});

test('операция по архивному счёту не принимается', () => {
  const cats = categories();
  const food = findCategory(cats, 'personal', 'expense');
  const archived = account('a1', { archived: true });
  const operation = expense('o1', 'a1', food.id, 100);

  assert.throws(() => validateOperation(operation, context([archived], cats)), (e: unknown) => {
    assert.ok(e instanceof DomainError);
    assert.equal(e.code, 'ACCOUNT_ARCHIVED');
    return true;
  });
});

test('корректировка остатка не требует категории', () => {
  const operation = adjustment('adj1', 'a1', -500);
  assert.doesNotThrow(() => validateOperation(operation, context()));
});

// --- Категории -------------------------------------------------------------

test('стартовых категорий два набора, и они разделены по контурам', () => {
  const cats = seedCategories(NOW, (seed, index) => `${index}`);
  const personal = cats.filter((category) => category.contour === 'personal');
  const business = cats.filter((category) => category.contour === 'business');

  assert.equal(personal.length, 10);
  assert.equal(business.length, 9);
  assert.ok(personal.every((category) => !category.hidden));
  // в каждом контуре есть и расходы, и доходы
  for (const set of [personal, business]) {
    assert.ok(set.some((category) => category.kind === 'expense'));
    assert.ok(set.some((category) => category.kind === 'income'));
  }
});

test('при вводе предлагаются только категории своего контура и направления', () => {
  const cats = categories();
  const forBusinessExpense = selectableCategories(cats, 'business', 'expense');
  assert.ok(forBusinessExpense.length > 0);
  assert.ok(forBusinessExpense.every((c) => c.contour === 'business' && c.kind === 'expense'));
  assert.ok(!forBusinessExpense.some((c) => c.name === 'Продукты'));
});

test('последние использованные категории идут первыми', () => {
  const cats = categories();
  const expenses = selectableCategories(cats, 'personal', 'expense');
  const rare = expenses[0];
  const frequent = expenses[3];

  const operations = [
    expense('o1', 'a1', rare.id, 100, { date: '2026-09-01' }),
    expense('o2', 'a1', frequent.id, 100, { date: '2026-10-22' }),
  ];

  const ordered = categoriesByRecentUse(cats, operations, 'personal', 'expense');
  assert.equal(ordered[0].id, frequent.id);
  assert.equal(ordered[1].id, rare.id);
});

test('категорию с операциями нельзя удалить — только перенести операции', () => {
  const cats = categories();
  const food = findCategory(cats, 'personal', 'expense');
  const other = selectableCategories(cats, 'personal', 'expense').at(-1)!;
  const operations = [expense('o1', 'a1', food.id, 100)];

  assert.throws(() => deleteCategory(food, operations, NOW), (e: unknown) => {
    assert.ok(e instanceof DomainError);
    assert.equal(e.code, 'CATEGORY_HAS_OPERATIONS');
    return true;
  });

  const moved = reassignOperations(operations, food.id, other, NOW);
  assert.equal((moved[0] as { categoryId: string }).categoryId, other.id);
  assert.doesNotThrow(() => deleteCategory(food, moved, NOW));
});

test('перенос в категорию другого контура запрещён', () => {
  const cats = categories();
  const personalFood = findCategory(cats, 'personal', 'expense');
  const businessAds = findCategory(cats, 'business', 'expense');
  const operations = [expense('o1', 'a1', personalFood.id, 100)];

  assert.throws(() => reassignOperations(operations, personalFood.id, businessAds, NOW));
});

// --- Офлайн-синхронизация --------------------------------------------------

test('при конфликте побеждает последняя запись, проигравшая сохраняется', () => {
  const local = [{ id: 'o1', updatedAt: '2026-10-23T12:00:00.000Z', amount: 100 }];
  const remote = [{ id: 'o1', updatedAt: '2026-10-23T11:00:00.000Z', amount: 200 }];

  const result = mergeCollections(local, remote);
  assert.equal(result.merged.length, 1);
  assert.equal(result.merged[0].amount, 100);
  assert.equal(result.conflicts.length, 1);
  assert.equal(result.conflicts[0].outcome, 'local');
  assert.equal(result.conflicts[0].loser?.amount, 200);
});

test('запись, которой нет на другой стороне, переносится без конфликта', () => {
  const local = [{ id: 'o1', updatedAt: NOW }];
  const remote = [{ id: 'o2', updatedAt: NOW }];

  const result = mergeCollections(local, remote);
  assert.equal(result.merged.length, 2);
  assert.equal(result.conflicts.length, 0);
});

test('одинаковые версии конфликтом не считаются', () => {
  const same = [{ id: 'o1', updatedAt: NOW }];
  const result = mergeCollections(same, [{ id: 'o1', updatedAt: NOW }]);
  assert.equal(result.conflicts.length, 0);
  assert.equal(result.merged.length, 1);
});

test('удаление участвует в слиянии на равных и может победить', () => {
  const local: Syncable[] = [{ id: 'o1', updatedAt: '2026-10-23T10:00:00.000Z' }];
  const remote: Syncable[] = [
    { id: 'o1', updatedAt: '2026-10-23T13:00:00.000Z', deletedAt: '2026-10-23T13:00:00.000Z' },
  ];

  const result = mergeCollections(local, remote);
  assert.equal(result.merged[0].deletedAt, '2026-10-23T13:00:00.000Z');
  assert.equal(result.conflicts[0].outcome, 'remote');
});

test('состояние синхронизации видно пользователю', () => {
  const item = { id: 'o1', updatedAt: '2026-10-23T12:00:00.000Z' };
  assert.equal(syncStateOf(item, undefined, new Set()), 'pending');
  assert.equal(syncStateOf(item, '2026-10-23T11:00:00.000Z', new Set()), 'pending');
  assert.equal(syncStateOf(item, '2026-10-23T12:00:00.000Z', new Set()), 'synced');
  assert.equal(syncStateOf(item, '2026-10-23T13:00:00.000Z', new Set(['o1'])), 'conflict');
});
