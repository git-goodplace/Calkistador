/**
 * Деньги в приложении — всегда целое число копеек.
 *
 * Причина: 0.1 + 0.2 !== 0.3 в double. В финансовом приложении копеечные
 * расхождения всплывают в остатках по счёту и в сумме налога, то есть ровно
 * там, где пользователь нам перестаёт верить. Поэтому в домене и в хранилище
 * нет ни одного числа с плавающей точкой — только копейки.
 */

/** Целое число копеек. Безопасно до 2^53 копеек ≈ 90 трлн ₽. */
export type Kopecks = number;

export const KOPECKS_IN_RUBLE = 100;

export function rubles(amount: number): Kopecks {
  return Math.round(amount * KOPECKS_IN_RUBLE);
}

export function toRubles(value: Kopecks): number {
  return value / KOPECKS_IN_RUBLE;
}

/** Округление до целых рублей — НК РФ требует этого для суммы налога. */
export function roundToRubles(value: Kopecks): Kopecks {
  return Math.round(value / KOPECKS_IN_RUBLE) * KOPECKS_IN_RUBLE;
}

/**
 * Доля от суммы в копейках. Округляет до копейки, половину — вверх по модулю,
 * чтобы -0.5 и 0.5 округлялись симметрично (Math.round(-0.5) === -0 ломает это).
 */
export function percentOf(value: Kopecks, percent: number): Kopecks {
  const raw = (value * percent) / 100;
  return raw < 0 ? -Math.round(-raw) : Math.round(raw);
}

export function clampToZero(value: Kopecks): Kopecks {
  return value < 0 ? 0 : value;
}

/**
 * Разбор того, что человек набрал на клавиатуре ввода: «1234,5», «1 234.50».
 * Возвращает null, если сумму прочитать нельзя — вызывающий код сам решает,
 * показать ошибку или просто не дать сохранить.
 */
export function parseRubleInput(text: string): Kopecks | null {
  const normalized = text.replace(/[\s ]/g, '').replace(',', '.');
  if (normalized === '' || normalized === '.') return null;
  if (!/^\d*\.?\d*$/.test(normalized)) return null;

  const [whole = '', fraction = ''] = normalized.split('.');
  // Больше двух знаков после запятой отбрасываем, а не округляем: человек
  // видит на экране ровно то, что набрал, и сюрприза в сумме не будет.
  const cents = (fraction + '00').slice(0, 2);
  const value = Number(whole || '0') * KOPECKS_IN_RUBLE + Number(cents);
  return Number.isFinite(value) ? value : null;
}

/** Формат для интерфейса: 1234567 -> "12 345,67 ₽" */
export function formatMoney(value: Kopecks, options: { withSign?: boolean } = {}): string {
  const negative = value < 0;
  const abs = Math.abs(value);
  const whole = Math.floor(abs / KOPECKS_IN_RUBLE);
  const cents = abs % KOPECKS_IN_RUBLE;
  const grouped = String(whole).replace(/\B(?=(\d{3})+(?!\d))/g, ' ');
  const sign = negative ? '−' : options.withSign ? '+' : '';
  return `${sign}${grouped},${String(cents).padStart(2, '0')} ₽`;
}
