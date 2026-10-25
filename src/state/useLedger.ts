import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { balancesByAccount, selectableAccounts } from '../domain/model/accounts.ts';
import { DomainError } from '../domain/model/errors.ts';
import { isLive } from '../domain/model/operations.ts';
import type { Operation } from '../domain/model/types.ts';
import { DexieLedgerRepository } from '../storage/dexie-repository.ts';
import type { LedgerRepository, LedgerSnapshot } from '../storage/repository.ts';
import { LedgerService } from './ledger-service.ts';

const EMPTY: LedgerSnapshot = { accounts: [], categories: [], operations: [] };

export interface LedgerApi {
  ready: boolean;
  error: string | undefined;
  clearError: () => void;
  snapshot: LedgerSnapshot;
  accounts: LedgerSnapshot['accounts'];
  balances: Map<string, number>;
  recent: Operation[];
  service: LedgerService;
  /** Оборачивает действие: показывает понятную ошибку домена вместо падения. */
  run: <T>(action: () => Promise<T>) => Promise<T | undefined>;
}

export function useLedger(repository?: LedgerRepository): LedgerApi {
  const serviceRef = useRef<LedgerService>(undefined as unknown as LedgerService);
  if (!serviceRef.current) {
    serviceRef.current = new LedgerService(repository ?? new DexieLedgerRepository());
  }
  const service = serviceRef.current;

  const [snapshot, setSnapshot] = useState<LedgerSnapshot>(EMPTY);
  const [ready, setReady] = useState(false);
  const [error, setError] = useState<string | undefined>();

  useEffect(() => {
    let cancelled = false;
    service
      .init()
      .then((loaded) => {
        if (!cancelled) {
          setSnapshot(loaded);
          setReady(true);
        }
      })
      .catch((cause: unknown) => {
        if (!cancelled) {
          setError(
            cause instanceof Error
              ? `Не удалось открыть локальную базу: ${cause.message}`
              : 'Не удалось открыть локальную базу',
          );
          setReady(true);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [service]);

  const run = useCallback(
    async <T,>(action: () => Promise<T>): Promise<T | undefined> => {
      try {
        const result = await action();
        setSnapshot({ ...service.state });
        return result;
      } catch (cause: unknown) {
        // Ошибка домена — это сообщение пользователю, а не сбой программы.
        setError(
          cause instanceof DomainError
            ? cause.message
            : cause instanceof Error
              ? cause.message
              : 'Что-то пошло не так',
        );
        return undefined;
      }
    },
    [service],
  );

  const balances = useMemo(
    () => balancesByAccount(snapshot.accounts, snapshot.operations),
    [snapshot],
  );

  const recent = useMemo(
    () =>
      snapshot.operations
        .filter(isLive)
        .slice()
        .sort((a, b) =>
          a.date === b.date ? b.createdAt.localeCompare(a.createdAt) : b.date.localeCompare(a.date),
        )
        .slice(0, 30),
    [snapshot],
  );

  return {
    ready,
    error,
    clearError: () => setError(undefined),
    snapshot,
    accounts: useMemo(() => selectableAccounts(snapshot.accounts), [snapshot]),
    balances,
    recent,
    service,
    run,
  };
}
