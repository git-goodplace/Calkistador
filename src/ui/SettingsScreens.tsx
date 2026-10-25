import { useState } from 'react';

import { formatMoney, parseRubleInput } from '../domain/money.ts';
import { hasOperations } from '../domain/model/accounts.ts';
import { selectableCategories } from '../domain/model/categories.ts';
import type { AccountType, CategoryKind, Contour } from '../domain/model/types.ts';
import type { LedgerApi } from '../state/useLedger.ts';
import { Segmented } from './EntryScreen.tsx';

export function AccountsScreen({ ledger }: { ledger: LedgerApi }) {
  const [name, setName] = useState('');
  const [type, setType] = useState<AccountType>('card');
  const [contour, setContour] = useState<Contour>('personal');
  const [initial, setInitial] = useState('');
  const [counting, setCounting] = useState<string | undefined>();
  const [counted, setCounted] = useState('');

  async function add() {
    if (name.trim() === '') return;
    const balance = parseRubleInput(initial) ?? 0;
    await ledger.run(() => ledger.service.addAccount(name.trim(), type, contour, balance));
    setName('');
    setInitial('');
  }

  async function reconcile(accountId: string) {
    const value = parseRubleInput(counted);
    if (value === null) return;
    await ledger.run(() => ledger.service.reconcileCash(accountId, value));
    setCounting(undefined);
    setCounted('');
  }

  return (
    <div className="space-y-4 px-4 pb-28 pt-4">
      <h1 className="text-lg font-semibold">Счета</h1>

      <div className="space-y-2">
        {ledger.accounts.map((account) => {
          const used = hasOperations(account.id, ledger.snapshot.operations);
          return (
            <div key={account.id} className="rounded-2xl bg-slate-900 px-4 py-3">
              <div className="flex items-center justify-between">
                <div>
                  <div className="text-sm">{account.name}</div>
                  <div className="text-[11px] text-slate-500">
                    {account.defaultContour === 'business' ? 'бизнес' : 'личное'} ·{' '}
                    {accountTypeLabel(account.type)}
                  </div>
                </div>
                <div className="tabular-nums">
                  {formatMoney(ledger.balances.get(account.id) ?? 0)}
                </div>
              </div>
              <div className="mt-2 flex gap-2">
                {account.type === 'cash' && (
                  <button
                    type="button"
                    onClick={() => setCounting(counting === account.id ? undefined : account.id)}
                    className="rounded-full bg-slate-800 px-3 py-1 text-xs active:bg-slate-700"
                  >
                    Пересчитать
                  </button>
                )}
                <button
                  type="button"
                  onClick={() =>
                    void ledger.run(() =>
                      used
                        ? ledger.service.archiveAccount(account.id)
                        : ledger.service.deleteAccount(account.id),
                    )
                  }
                  className="rounded-full bg-slate-800 px-3 py-1 text-xs text-slate-400 active:bg-slate-700"
                >
                  {used ? 'В архив' : 'Удалить'}
                </button>
              </div>
              {counting === account.id && (
                <div className="mt-3 flex gap-2">
                  <input
                    value={counted}
                    onChange={(event) => setCounted(event.target.value)}
                    inputMode="decimal"
                    placeholder="сколько в кошельке"
                    className="flex-1 rounded-lg bg-slate-800 px-3 py-2 text-sm placeholder:text-slate-600"
                  />
                  <button
                    type="button"
                    onClick={() => void reconcile(account.id)}
                    className="rounded-lg bg-emerald-600 px-3 py-2 text-sm"
                  >
                    Готово
                  </button>
                </div>
              )}
            </div>
          );
        })}
      </div>

      <div className="space-y-3 rounded-2xl bg-slate-900 p-4">
        <h2 className="text-sm font-medium">Новый счёт</h2>
        <input
          value={name}
          onChange={(event) => setName(event.target.value)}
          placeholder="Название"
          className="w-full rounded-lg bg-slate-800 px-3 py-2 text-sm placeholder:text-slate-600"
        />
        <Segmented
          value={contour}
          onChange={setContour}
          options={[
            { value: 'personal', label: 'Личное' },
            { value: 'business', label: 'Бизнес' },
          ]}
        />
        <select
          value={type}
          onChange={(event) => setType(event.target.value as AccountType)}
          className="w-full rounded-lg bg-slate-800 px-3 py-2 text-sm"
        >
          <option value="card">Карта</option>
          <option value="cash">Наличные</option>
          <option value="business">Расчётный счёт</option>
          <option value="savings">Накопительный</option>
        </select>
        <input
          value={initial}
          onChange={(event) => setInitial(event.target.value)}
          inputMode="decimal"
          placeholder="Начальный остаток, ₽"
          className="w-full rounded-lg bg-slate-800 px-3 py-2 text-sm placeholder:text-slate-600"
        />
        <button
          type="button"
          onClick={() => void add()}
          className="w-full rounded-lg bg-emerald-600 py-2 text-sm font-medium"
        >
          Добавить счёт
        </button>
      </div>
    </div>
  );
}

export function CategoriesScreen({ ledger }: { ledger: LedgerApi }) {
  const [contour, setContour] = useState<Contour>('personal');
  const [kind, setKind] = useState<CategoryKind>('expense');
  const [name, setName] = useState('');

  const list = selectableCategories(ledger.snapshot.categories, contour, kind);

  async function add() {
    if (name.trim() === '') return;
    await ledger.run(() => ledger.service.addCategory(name.trim(), kind, contour));
    setName('');
  }

  return (
    <div className="space-y-4 px-4 pb-28 pt-4">
      <h1 className="text-lg font-semibold">Категории</h1>

      <Segmented
        value={contour}
        onChange={setContour}
        options={[
          { value: 'personal', label: 'Личное' },
          { value: 'business', label: 'Бизнес' },
        ]}
      />
      <Segmented
        value={kind}
        onChange={setKind}
        options={[
          { value: 'expense', label: 'Расходы' },
          { value: 'income', label: 'Доходы' },
        ]}
      />

      <p className="text-xs text-slate-500">
        Категории привязаны к контуру: в бизнес-операции личные категории не предлагаются.
      </p>

      <div className="space-y-2">
        {list.map((category) => (
          <div
            key={category.id}
            className="flex items-center justify-between rounded-2xl bg-slate-900 px-4 py-3"
          >
            <div className="flex items-center gap-3">
              <span style={{ color: category.color }}>{category.icon}</span>
              <span className="text-sm">{category.name}</span>
            </div>
            <button
              type="button"
              onClick={() => void ledger.run(() => ledger.service.hideCategory(category.id))}
              className="rounded-full bg-slate-800 px-3 py-1 text-xs text-slate-400 active:bg-slate-700"
            >
              Скрыть
            </button>
          </div>
        ))}
      </div>

      <div className="space-y-3 rounded-2xl bg-slate-900 p-4">
        <h2 className="text-sm font-medium">Новая категория</h2>
        <input
          value={name}
          onChange={(event) => setName(event.target.value)}
          placeholder="Название"
          className="w-full rounded-lg bg-slate-800 px-3 py-2 text-sm placeholder:text-slate-600"
        />
        <button
          type="button"
          onClick={() => void add()}
          className="w-full rounded-lg bg-emerald-600 py-2 text-sm font-medium"
        >
          Добавить в «{contour === 'personal' ? 'Личное' : 'Бизнес'} ·{' '}
          {kind === 'expense' ? 'Расходы' : 'Доходы'}»
        </button>
      </div>
    </div>
  );
}

function accountTypeLabel(type: AccountType): string {
  switch (type) {
    case 'card':
      return 'карта';
    case 'cash':
      return 'наличные';
    case 'business':
      return 'расчётный счёт';
    case 'savings':
      return 'накопительный';
  }
}
