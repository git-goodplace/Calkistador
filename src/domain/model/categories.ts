import { domainError } from './errors.ts';
import { isLive } from './operations.ts';
import type { Category, CategoryId, CategoryKind, Contour, Operation } from './types.ts';

/**
 * Стартовые категории — по 8–10 на контур.
 * Длинный список отпугивает: пользователь должен узнать свои траты с первого
 * экрана, а не выбирать из сорока вариантов. Остальное он добавит сам.
 */
interface CategorySeed {
  name: string;
  kind: CategoryKind;
  contour: Contour;
  icon: string;
  color: string;
}

const PERSONAL_SEEDS: CategorySeed[] = [
  { name: 'Продукты', kind: 'expense', contour: 'personal', icon: '🛒', color: '#2E7D32' },
  { name: 'Кафе и доставка', kind: 'expense', contour: 'personal', icon: '🍜', color: '#EF6C00' },
  { name: 'Транспорт', kind: 'expense', contour: 'personal', icon: '🚇', color: '#1565C0' },
  { name: 'Жильё и связь', kind: 'expense', contour: 'personal', icon: '🏠', color: '#6A1B9A' },
  { name: 'Здоровье', kind: 'expense', contour: 'personal', icon: '💊', color: '#C62828' },
  { name: 'Покупки', kind: 'expense', contour: 'personal', icon: '🛍', color: '#AD1457' },
  { name: 'Развлечения', kind: 'expense', contour: 'personal', icon: '🎬', color: '#00838F' },
  { name: 'Прочее', kind: 'expense', contour: 'personal', icon: '•', color: '#546E7A' },
  { name: 'Зарплата', kind: 'income', contour: 'personal', icon: '💼', color: '#2E7D32' },
  { name: 'Прочий доход', kind: 'income', contour: 'personal', icon: '➕', color: '#558B2F' },
];

const BUSINESS_SEEDS: CategorySeed[] = [
  { name: 'Налоги и взносы', kind: 'expense', contour: 'business', icon: '🧾', color: '#C62828' },
  { name: 'Реклама', kind: 'expense', contour: 'business', icon: '📣', color: '#EF6C00' },
  { name: 'Подрядчики', kind: 'expense', contour: 'business', icon: '🤝', color: '#1565C0' },
  { name: 'Сервисы и подписки', kind: 'expense', contour: 'business', icon: '🔧', color: '#6A1B9A' },
  { name: 'Оборудование', kind: 'expense', contour: 'business', icon: '💻', color: '#00838F' },
  { name: 'Комиссии банка', kind: 'expense', contour: 'business', icon: '🏦', color: '#5D4037' },
  { name: 'Прочие расходы', kind: 'expense', contour: 'business', icon: '•', color: '#546E7A' },
  { name: 'Оплата от клиента', kind: 'income', contour: 'business', icon: '💰', color: '#2E7D32' },
  { name: 'Возврат и прочее', kind: 'income', contour: 'business', icon: '➕', color: '#558B2F' },
];

/** Категории при первом входе: два набора, личный и бизнес. */
export function seedCategories(
  now: string,
  makeId: (seed: CategorySeed, index: number) => string,
): Category[] {
  return [...PERSONAL_SEEDS, ...BUSINESS_SEEDS].map((seed, index) => ({
    id: makeId(seed, index),
    name: seed.name,
    kind: seed.kind,
    contour: seed.contour,
    icon: seed.icon,
    color: seed.color,
    hidden: false,
    sortOrder: index,
    updatedAt: now,
  }));
}

/** Категории, предлагаемые при вводе: своего контура, своего направления, не скрытые. */
export function selectableCategories(
  categories: readonly Category[],
  contour: Contour,
  kind: CategoryKind,
): Category[] {
  return categories
    .filter(
      (category) =>
        category.contour === contour &&
        category.kind === kind &&
        !category.hidden &&
        category.deletedAt === undefined,
    )
    .sort((a, b) => a.sortOrder - b.sortOrder);
}

/**
 * Последние использованные категории — первыми.
 * Требование фичи быстрого ввода: без этого каждая трата стоит лишнего скролла.
 */
export function categoriesByRecentUse(
  categories: readonly Category[],
  operations: readonly Operation[],
  contour: Contour,
  kind: CategoryKind,
): Category[] {
  const lastUsed = new Map<CategoryId, string>();
  for (const operation of operations) {
    if (!isLive(operation)) continue;
    if (operation.kind !== 'expense' && operation.kind !== 'income') continue;
    const previous = lastUsed.get(operation.categoryId);
    if (previous === undefined || operation.date > previous) {
      lastUsed.set(operation.categoryId, operation.date);
    }
  }

  return selectableCategories(categories, contour, kind).sort((a, b) => {
    const usedA = lastUsed.get(a.id);
    const usedB = lastUsed.get(b.id);
    if (usedA && usedB) return usedB.localeCompare(usedA);
    if (usedA) return -1;
    if (usedB) return 1;
    return a.sortOrder - b.sortOrder;
  });
}

export function hasOperations(categoryId: CategoryId, operations: readonly Operation[]): boolean {
  return operations
    .filter(isLive)
    .some(
      (operation) =>
        (operation.kind === 'expense' || operation.kind === 'income') &&
        operation.categoryId === categoryId,
    );
}

export function hideCategory(category: Category, now: string): Category {
  return { ...category, hidden: true, updatedAt: now };
}

/**
 * Удалить категорию с операциями нельзя — только перенести операции в другую.
 * Иначе операции осиротеют и выпадут из отчётов.
 */
export function deleteCategory(
  category: Category,
  operations: readonly Operation[],
  now: string,
): Category {
  if (hasOperations(category.id, operations)) {
    throw domainError(
      'CATEGORY_HAS_OPERATIONS',
      `В категории «${category.name}» есть операции — перенесите их или скройте категорию`,
    );
  }
  return { ...category, deletedAt: now, updatedAt: now };
}

/** Перенос операций в другую категорию — шаг перед удалением. */
export function reassignOperations(
  operations: readonly Operation[],
  fromCategoryId: CategoryId,
  to: Category,
  now: string,
): Operation[] {
  return operations.map((operation) => {
    if (operation.kind !== 'expense' && operation.kind !== 'income') return operation;
    if (operation.categoryId !== fromCategoryId) return operation;
    if (to.kind !== operation.kind || to.contour !== operation.contour) {
      throw domainError(
        'CATEGORY_CONTOUR_MISMATCH',
        `Категория «${to.name}» не подходит для переноса: другой контур или направление`,
      );
    }
    return { ...operation, categoryId: to.id, updatedAt: now };
  });
}
