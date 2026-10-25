import { useMemo, useState } from 'react';

import { formatMoney, parseRubleInput } from '../domain/money.ts';
import { categoriesByRecentUse } from '../domain/model/categories.ts';
import type { Contour, PayerKind } from '../domain/model/types.ts';
import type { LedgerApi } from '../state/useLedger.ts';
import { today } from '../state/ledger-service.ts';
import { systemClock } from '../state/ledger-service.ts';

type EntryKind = 'expense' | 'income' | 'transfer';

interface Props {
  ledger: LedgerApi;
  onClose: () => void;
  onSaved: (operationId: string) => void;
}

/**
 * Экран быстрого ввода — главная фича первого этапа.
 *
 * Критерий: от главного экрана до сохранённой траты не больше трёх касаний.
 * Здесь их два: набрать сумму и ткнуть категорию — категория сохраняет сразу,
 * без отдельной кнопки. Всё остальное (счёт, дата, заметка) живёт под «Ещё»
 * и имеет значения по умолчанию.
 */
export function EntryScreen({ ledger, onClose, onSaved }: Props) {
  const [kind, setKind] = useState<EntryKind>('expense');
  const [contour, setContour] = useState<Contour>('personal');
  const [digits, setDigits] = useState('');
  const [payerKind, setPayerKind] = useState<PayerKind>('business');
  const [showMore, setShowMore] = useState(false);
  const [note, setNote] = useState('');
  const [date, setDate] = useState(() => today(systemClock));
  const [busy, setBusy] = useState(false);

  const accounts = ledger.accounts;
  const contourAccounts = accounts.filter((item) => item.defaultContour === contour);
  const defaultAccount = contourAccounts[0] ?? accounts[0];
  const [accountId, setAccountId] = useState<string | undefined>(undefined);
  const activeAccountId = accountId ?? defaultAccount?.id;

  const [fromAccountId, setFromAccountId] = useState<string | undefined>(undefined);
  const [toAccountId, setToAccountId] = useState<string | undefined>(undefined);

  const amount = parseRubleInput(digits);
  const canSave = amount !== null && amount > 0 && !busy;

  const categories = useMemo(
    () =>
      kind === 'transfer'
        ? []
        : categoriesByRecentUse(
            ledger.snapshot.categories,
            ledger.snapshot.operations,
            contour,
            kind,
          ),
    [ledger.snapshot, contour, kind],
  );

  function press(key: string) {
    setDigits((current) => {
      if (key === 'del') return current.slice(0, -1);
      if (key === ',') return current.includes(',') ? current : current === '' ? '0,' : current + ',';
      // не даём набрать больше двух знаков после запятой
      const [, fraction] = current.split(',');
      if (fraction !== undefined && fraction.length >= 2) return current;
      if (current === '0') return key;
      return current + key;
    });
  }

  async function saveWithCategory(categoryId: string) {
    if (!canSave || !activeAccountId || amount === null) return;
    setBusy(true);
    const common = {
      amount,
      categoryId,
      accountId: activeAccountId,
      contour,
      date,
      note: note.trim() === '' ? undefined : note.trim(),
    };
    const saved = await ledger.run(() =>
      kind === 'expense'
        ? ledger.service.addExpense(common)
        : ledger.service.addIncome({
            ...common,
            payerKind: contour === 'business' ? payerKind : undefined,
          }),
    );
    setBusy(false);
    if (saved) onSaved(saved.id);
  }

  async function saveTransfer() {
    const from = fromAccountId ?? accounts[0]?.id;
    const to = toAccountId ?? accounts.find((item) => item.id !== from)?.id;
    if (!canSave || !from || !to || amount === null) return;
    setBusy(true);
    const saved = await ledger.run(() =>
      ledger.service.addTransfer({
        fromAccountId: from,
        toAccountId: to,
        amount,
        date,
        note: note.trim() === '' ? undefined : note.trim(),
      }),
    );
    setBusy(false);
    if (saved) onSaved(saved.id);
  }

  return (
    <div className="fixed inset-0 z-30 flex flex-col bg-slate-950 text-slate-100">
      <header className="flex items-center justify-between px-4 pt-4">
        <button
          type="button"
          onClick={onClose}
          className="rounded-full px-3 py-2 text-sm text-slate-400 active:bg-slate-800"
        >
          Отмена
        </button>
        <Segmented
          value={contour}
          onChange={(value) => {
            setContour(value);
            setAccountId(undefined);
          }}
          options={[
            { value: 'personal', label: 'Личное' },
            { value: 'business', label: 'Бизнес' },
          ]}
        />
        <button
          type="button"
          onClick={() => setShowMore((v) => !v)}
          className="rounded-full px-3 py-2 text-sm text-slate-400 active:bg-slate-800"
        >
          Ещё
        </button>
      </header>

      <div className="px-4 pt-3">
        <Segmented
          value={kind}
          onChange={setKind}
          options={[
            { value: 'expense', label: 'Расход' },
            { value: 'income', label: 'Доход' },
            { value: 'transfer', label: 'Перевод' },
          ]}
        />
      </div>

      <div className="flex min-h-24 flex-col items-center justify-center px-4 py-5">
        <div className="text-4xl font-semibold tabular-nums">
          {digits === '' ? <span className="text-slate-600">0</span> : digits} ₽
        </div>
        <div className="mt-1 text-xs text-slate-500">
          {activeAccountName(ledger, activeAccountId, kind)} · {formatRuDate(date)}
        </div>
      </div>

      {showMore && (
        <div className="mx-4 mb-3 space-y-3 rounded-2xl bg-slate-900 p-3 text-sm">
          {kind !== 'transfer' && (
            <Field label="Счёт">
              <select
                value={activeAccountId ?? ''}
                onChange={(event) => setAccountId(event.target.value)}
                className="w-full rounded-lg bg-slate-800 px-3 py-2"
              >
                {accounts.map((item) => (
                  <option key={item.id} value={item.id}>
                    {item.name}
                  </option>
                ))}
              </select>
            </Field>
          )}
          <Field label="Дата">
            <input
              type="date"
              value={date}
              onChange={(event) => setDate(event.target.value)}
              className="w-full rounded-lg bg-slate-800 px-3 py-2"
            />
          </Field>
          <Field label="Заметка">
            <input
              value={note}
              onChange={(event) => setNote(event.target.value)}
              placeholder="необязательно"
              className="w-full rounded-lg bg-slate-800 px-3 py-2 placeholder:text-slate-600"
            />
          </Field>
        </div>
      )}

      {kind === 'income' && contour === 'business' && (
        <div className="mx-4 mb-3 rounded-2xl bg-slate-900 p-3">
          <div className="mb-2 text-xs text-slate-400">
            От кого оплата — от этого зависит ставка НПД: 4% с физлиц, 6% с организаций
          </div>
          <Segmented
            value={payerKind}
            onChange={setPayerKind}
            options={[
              { value: 'business', label: 'Организация или ИП' },
              { value: 'individual', label: 'Физлицо' },
            ]}
          />
        </div>
      )}

      {kind === 'transfer' ? (
        <div className="mx-4 mb-3 space-y-3 rounded-2xl bg-slate-900 p-3 text-sm">
          <Field label="Откуда">
            <select
              value={fromAccountId ?? accounts[0]?.id ?? ''}
              onChange={(event) => setFromAccountId(event.target.value)}
              className="w-full rounded-lg bg-slate-800 px-3 py-2"
            >
              {accounts.map((item) => (
                <option key={item.id} value={item.id}>
                  {item.name}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Куда">
            <select
              value={toAccountId ?? accounts.find((i) => i.id !== (fromAccountId ?? accounts[0]?.id))?.id ?? ''}
              onChange={(event) => setToAccountId(event.target.value)}
              className="w-full rounded-lg bg-slate-800 px-3 py-2"
            >
              {accounts.map((item) => (
                <option key={item.id} value={item.id}>
                  {item.name}
                </option>
              ))}
            </select>
          </Field>
          <p className="text-xs text-slate-500">
            Перевод не попадёт ни в доходы, ни в расходы — он только двигает деньги между
            счетами.
          </p>
        </div>
      ) : (
        <div className="flex-1 overflow-y-auto px-4">
          <div className="grid grid-cols-4 gap-2 pb-2">
            {categories.map((category) => (
              <button
                key={category.id}
                type="button"
                disabled={!canSave}
                onClick={() => void saveWithCategory(category.id)}
                className="flex flex-col items-center gap-1 rounded-2xl bg-slate-900 px-1 py-3 text-center active:bg-slate-800 disabled:opacity-40"
              >
                <span className="text-xl leading-none" style={{ color: category.color }}>
                  {category.icon}
                </span>
                <span className="text-[11px] leading-tight text-slate-300">{category.name}</span>
              </button>
            ))}
          </div>
          {!canSave && (
            <p className="pb-2 text-center text-xs text-slate-500">
              Наберите сумму и нажмите категорию — операция сохранится сразу
            </p>
          )}
        </div>
      )}

      <div className="mt-auto grid grid-cols-3 gap-px bg-slate-800 pb-[env(safe-area-inset-bottom)]">
        {['1', '2', '3', '4', '5', '6', '7', '8', '9', ',', '0', 'del'].map((key) => (
          <button
            key={key}
            type="button"
            onClick={() => press(key)}
            className="bg-slate-950 py-4 text-2xl font-medium active:bg-slate-900"
          >
            {key === 'del' ? '⌫' : key}
          </button>
        ))}
        {kind === 'transfer' && (
          <button
            type="button"
            disabled={!canSave}
            onClick={() => void saveTransfer()}
            className="col-span-3 bg-emerald-600 py-4 text-lg font-semibold disabled:opacity-40"
          >
            Сохранить перевод {amount !== null && amount > 0 ? formatMoney(amount) : ''}
          </button>
        )}
      </div>
    </div>
  );
}

function activeAccountName(ledger: LedgerApi, accountId: string | undefined, kind: EntryKind) {
  if (kind === 'transfer') return 'перевод между счетами';
  return ledger.accounts.find((item) => item.id === accountId)?.name ?? 'нет счёта';
}

export function formatRuDate(date: string): string {
  const [year, month, day] = date.split('-');
  if (!year || !month || !day) return date;
  const months = [
    'января', 'февраля', 'марта', 'апреля', 'мая', 'июня',
    'июля', 'августа', 'сентября', 'октября', 'ноября', 'декабря',
  ];
  return `${Number(day)} ${months[Number(month) - 1] ?? month}`;
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="mb-1 block text-xs text-slate-400">{label}</span>
      {children}
    </label>
  );
}

interface SegmentedProps<T extends string> {
  value: T;
  onChange: (value: T) => void;
  options: { value: T; label: string }[];
}

export function Segmented<T extends string>({ value, onChange, options }: SegmentedProps<T>) {
  return (
    <div className="flex rounded-full bg-slate-900 p-1">
      {options.map((option) => (
        <button
          key={option.value}
          type="button"
          onClick={() => onChange(option.value)}
          className={`flex-1 whitespace-nowrap rounded-full px-3 py-1.5 text-sm transition ${
            option.value === value ? 'bg-slate-700 text-white' : 'text-slate-400'
          }`}
        >
          {option.label}
        </button>
      ))}
    </div>
  );
}
