import { useEffect, useState } from 'react';

import { useLedger } from '../state/useLedger.ts';
import { EntryScreen } from './EntryScreen.tsx';
import { HomeScreen } from './HomeScreen.tsx';
import { AccountsScreen, CategoriesScreen } from './SettingsScreens.tsx';

type Tab = 'home' | 'accounts' | 'categories';

export function App() {
  const ledger = useLedger();
  const [tab, setTab] = useState<Tab>('home');
  const [entryOpen, setEntryOpen] = useState(false);
  const [undoId, setUndoId] = useState<string | undefined>();
  const [online, setOnline] = useState(() => navigator.onLine);

  useEffect(() => {
    const update = () => setOnline(navigator.onLine);
    window.addEventListener('online', update);
    window.addEventListener('offline', update);
    return () => {
      window.removeEventListener('online', update);
      window.removeEventListener('offline', update);
    };
  }, []);

  // Отмена живёт 6 секунд: требование быстрого ввода — исправить ошибку
  // сразу, не заходя в историю.
  useEffect(() => {
    if (!undoId) return;
    const timer = setTimeout(() => setUndoId(undefined), 6000);
    return () => clearTimeout(timer);
  }, [undoId]);

  if (!ledger.ready) {
    return (
      <div className="flex min-h-dvh items-center justify-center bg-slate-950 text-slate-500">
        Открываем вашу базу…
      </div>
    );
  }

  return (
    <div className="min-h-dvh bg-slate-950 text-slate-100">
      {!online && (
        <div className="bg-amber-900/60 px-4 py-1.5 text-center text-xs text-amber-200">
          Нет сети — приложение работает, записи сохраняются на устройстве
        </div>
      )}

      {tab === 'home' && <HomeScreen ledger={ledger} />}
      {tab === 'accounts' && <AccountsScreen ledger={ledger} />}
      {tab === 'categories' && <CategoriesScreen ledger={ledger} />}

      {ledger.error && (
        <div className="fixed inset-x-3 bottom-24 z-40 rounded-2xl bg-rose-900 px-4 py-3 text-sm shadow-lg">
          <div className="flex items-start gap-3">
            <span className="flex-1">{ledger.error}</span>
            <button type="button" onClick={ledger.clearError} className="text-rose-200">
              Понятно
            </button>
          </div>
        </div>
      )}

      {undoId && !ledger.error && (
        <div className="fixed inset-x-3 bottom-24 z-40 flex items-center gap-3 rounded-2xl bg-slate-800 px-4 py-3 text-sm shadow-lg">
          <span className="flex-1">Сохранено</span>
          <button
            type="button"
            onClick={() => {
              const id = undoId;
              setUndoId(undefined);
              void ledger.run(() => ledger.service.removeOperation(id));
            }}
            className="font-medium text-emerald-400"
          >
            Отменить
          </button>
        </div>
      )}

      <nav className="fixed inset-x-0 bottom-0 z-20 flex items-stretch border-t border-slate-800 bg-slate-950/95 pb-[env(safe-area-inset-bottom)] backdrop-blur">
        <TabButton active={tab === 'home'} onClick={() => setTab('home')} label="Главная" />
        <div className="relative w-20">
          <button
            type="button"
            onClick={() => setEntryOpen(true)}
            aria-label="Добавить операцию"
            className="absolute -top-5 left-1/2 h-14 w-14 -translate-x-1/2 rounded-full bg-emerald-600 text-3xl leading-none shadow-lg active:bg-emerald-700"
          >
            +
          </button>
        </div>
        <TabButton active={tab === 'accounts'} onClick={() => setTab('accounts')} label="Счета" />
        <TabButton
          active={tab === 'categories'}
          onClick={() => setTab('categories')}
          label="Категории"
        />
      </nav>

      {entryOpen && (
        <EntryScreen
          ledger={ledger}
          onClose={() => setEntryOpen(false)}
          onSaved={(id) => {
            setEntryOpen(false);
            setUndoId(id);
          }}
        />
      )}
    </div>
  );
}

function TabButton({
  active,
  onClick,
  label,
}: {
  active: boolean;
  onClick: () => void;
  label: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`flex-1 py-3 text-xs ${active ? 'text-emerald-400' : 'text-slate-500'}`}
    >
      {label}
    </button>
  );
}
