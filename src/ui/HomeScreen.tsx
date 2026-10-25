import { useMemo, useState } from 'react';

import { formatMoney } from '../domain/money.ts';
import { totalBalance } from '../domain/model/accounts.ts';
import { isContourTransfer, totalExpenses, totalIncome } from '../domain/model/operations.ts';
import type { Contour, Operation } from '../domain/model/types.ts';
import type { LedgerApi } from '../state/useLedger.ts';
import { Segmented, formatRuDate } from './EntryScreen.tsx';

type Scope = Contour | 'all';

export function HomeScreen({ ledger }: { ledger: LedgerApi }) {
  const [scope, setScope] = useState<Scope>('all');
  const contour = scope === 'all' ? undefined : scope;

  const accountsInScope = ledger.accounts.filter(
    (item) => contour === undefined || item.defaultContour === contour,
  );

  const total = totalBalance(ledger.snapshot.accounts, ledger.snapshot.operations, contour);

  const operations = useMemo(
    () =>
      ledger.recent.filter((operation) => {
        if (contour === undefined) return true;
        if (operation.kind === 'expense' || operation.kind === 'income') {
          return operation.contour === contour;
        }
        // переводы и корректировки относим к контуру счёта
        const accountId =
          operation.kind === 'transfer' ? operation.fromAccountId : operation.accountId;
        return (
          ledger.snapshot.accounts.find((item) => item.id === accountId)?.defaultContour === contour
        );
      }),
    [ledger.recent, ledger.snapshot.accounts, contour],
  );

  const income = totalIncome(ledger.snapshot.operations, contour);
  const expenses = totalExpenses(ledger.snapshot.operations, contour);

  return (
    <div className="space-y-4 px-4 pb-28 pt-4">
      <Segmented
        value={scope}
        onChange={setScope}
        options={[
          { value: 'all', label: 'Всё' },
          { value: 'personal', label: 'Личное' },
          { value: 'business', label: 'Бизнес' },
        ]}
      />

      <section className="rounded-3xl bg-slate-900 p-4">
        <div className="text-xs text-slate-400">
          {scope === 'all' ? 'Всего на счетах' : scope === 'personal' ? 'Личные деньги' : 'Деньги бизнеса'}
        </div>
        <div className="mt-1 text-3xl font-semibold tabular-nums">{formatMoney(total)}</div>
        <div className="mt-3 flex gap-4 text-xs">
          <span className="text-emerald-400">Доходы {formatMoney(income)}</span>
          <span className="text-rose-400">Расходы {formatMoney(expenses)}</span>
        </div>
      </section>

      <section className="space-y-2">
        <h2 className="px-1 text-xs uppercase tracking-wide text-slate-500">Счета</h2>
        {accountsInScope.length === 0 && (
          <p className="px-1 text-sm text-slate-500">В этом контуре ещё нет счетов.</p>
        )}
        {accountsInScope.map((account) => (
          <div
            key={account.id}
            className="flex items-center justify-between rounded-2xl bg-slate-900 px-4 py-3"
          >
            <div>
              <div className="text-sm">{account.name}</div>
              <div className="text-[11px] text-slate-500">
                {account.defaultContour === 'business' ? 'бизнес' : 'личное'}
                {account.type === 'cash' ? ' · наличные' : ''}
              </div>
            </div>
            <div className="tabular-nums">{formatMoney(ledger.balances.get(account.id) ?? 0)}</div>
          </div>
        ))}
      </section>

      <section className="space-y-2">
        <h2 className="px-1 text-xs uppercase tracking-wide text-slate-500">Последние операции</h2>
        {operations.length === 0 && (
          <p className="px-1 text-sm text-slate-500">
            Пока пусто. Нажмите «плюс» и наберите первую трату — это два касания.
          </p>
        )}
        {operations.map((operation) => (
          <OperationRow key={operation.id} operation={operation} ledger={ledger} />
        ))}
      </section>
    </div>
  );
}

function OperationRow({ operation, ledger }: { operation: Operation; ledger: LedgerApi }) {
  const accounts = useMemo(
    () => new Map(ledger.snapshot.accounts.map((item) => [item.id, item])),
    [ledger.snapshot.accounts],
  );
  const category =
    operation.kind === 'expense' || operation.kind === 'income'
      ? ledger.snapshot.categories.find((item) => item.id === operation.categoryId)
      : undefined;

  let title: string;
  let subtitle: string;
  let amount: string;
  let tone: string;

  if (operation.kind === 'expense') {
    title = category?.name ?? 'Расход';
    subtitle = accounts.get(operation.accountId)?.name ?? '';
    amount = `−${formatMoney(operation.amount)}`;
    tone = 'text-slate-100';
  } else if (operation.kind === 'income') {
    title = category?.name ?? 'Доход';
    subtitle =
      (accounts.get(operation.accountId)?.name ?? '') +
      (operation.payerKind ? (operation.payerKind === 'individual' ? ' · от физлица' : ' · от организации') : '');
    amount = `+${formatMoney(operation.amount)}`;
    tone = 'text-emerald-400';
  } else if (operation.kind === 'transfer') {
    const crossContour = isContourTransfer(operation, accounts);
    title = crossContour ? 'Перевод между контурами' : 'Перевод';
    subtitle = `${accounts.get(operation.fromAccountId)?.name ?? '?'} → ${
      accounts.get(operation.toAccountId)?.name ?? '?'
    }`;
    amount = formatMoney(operation.amount);
    tone = 'text-slate-400';
  } else {
    title = 'Расхождение при пересчёте';
    subtitle = accounts.get(operation.accountId)?.name ?? '';
    amount = formatMoney(operation.delta, { withSign: true });
    tone = 'text-amber-400';
  }

  return (
    <div className="flex items-center justify-between rounded-2xl bg-slate-900 px-4 py-3">
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          {category && (
            <span style={{ color: category.color }} className="text-sm leading-none">
              {category.icon}
            </span>
          )}
          <span className="truncate text-sm">{title}</span>
        </div>
        <div className="truncate text-[11px] text-slate-500">
          {formatRuDate(operation.date)}
          {subtitle ? ` · ${subtitle}` : ''}
          {operation.note ? ` · ${operation.note}` : ''}
        </div>
      </div>
      <div className="flex items-center gap-3">
        <span className={`tabular-nums ${tone}`}>{amount}</span>
        <button
          type="button"
          onClick={() => void ledger.run(() => ledger.service.removeOperation(operation.id))}
          aria-label="Удалить операцию"
          className="rounded-full px-2 py-1 text-xs text-slate-600 active:bg-slate-800"
        >
          ✕
        </button>
      </div>
    </div>
  );
}
