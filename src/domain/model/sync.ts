/**
 * Слияние изменений при офлайн-синхронизации.
 *
 * Правило — «последняя запись побеждает» по `updatedAt`, и обе версии
 * остаются в журнале. Это не лучший из возможных алгоритмов, но единственный
 * предсказуемый без сервера-арбитра: пользователь должен иметь возможность
 * увидеть, что именно перезаписалось.
 *
 * Серверной части пока нет — это ядро фичи «работа офлайн», и оно должно
 * существовать до того, как появится слой хранения, иначе его придётся
 * переписывать вместе с ним.
 */

export interface Syncable {
  id: string;
  updatedAt: string;
  deletedAt?: string;
}

export type MergeOutcome = 'local' | 'remote' | 'identical';

export interface MergeDecision<T extends Syncable> {
  id: string;
  winner: T;
  outcome: MergeOutcome;
  /** Проигравшая версия — сохраняется в журнале, не выбрасывается. */
  loser?: T;
}

export interface MergeResult<T extends Syncable> {
  merged: T[];
  /** Записи, изменённые на обеих сторонах: их пользователь может пересмотреть. */
  conflicts: MergeDecision<T>[];
}

/**
 * Сливает две коллекции. Удаление — тоже изменение: запись с `deletedAt`
 * участвует в сравнении на равных и может победить.
 */
export function mergeCollections<T extends Syncable>(
  local: readonly T[],
  remote: readonly T[],
): MergeResult<T> {
  const byId = new Map<string, T>();
  for (const item of local) byId.set(item.id, item);

  const merged: T[] = [];
  const conflicts: MergeDecision<T>[] = [];
  const seen = new Set<string>();

  for (const remoteItem of remote) {
    seen.add(remoteItem.id);
    const localItem = byId.get(remoteItem.id);

    if (!localItem) {
      merged.push(remoteItem);
      continue;
    }

    if (localItem.updatedAt === remoteItem.updatedAt) {
      merged.push(localItem);
      continue;
    }

    const localWins = localItem.updatedAt > remoteItem.updatedAt;
    const winner = localWins ? localItem : remoteItem;
    const loser = localWins ? remoteItem : localItem;
    merged.push(winner);
    conflicts.push({
      id: remoteItem.id,
      winner,
      loser,
      outcome: localWins ? 'local' : 'remote',
    });
  }

  for (const localItem of local) {
    if (!seen.has(localItem.id)) merged.push(localItem);
  }

  return { merged, conflicts };
}

export type SyncState = 'synced' | 'pending' | 'conflict';

/**
 * Что показать пользователю рядом с операцией.
 * Требование фичи: состояние «не синхронизировано» должно быть видно, иначе
 * человек не поймёт, почему на другом устройстве траты нет.
 */
export function syncStateOf(
  item: Syncable,
  lastSyncedAt: string | undefined,
  conflictIds: ReadonlySet<string>,
): SyncState {
  if (conflictIds.has(item.id)) return 'conflict';
  if (!lastSyncedAt) return 'pending';
  return item.updatedAt <= lastSyncedAt ? 'synced' : 'pending';
}
