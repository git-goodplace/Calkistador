import { rubles } from '../money.ts';
import type { RegimeDefinition, RegimeId, TaxParams } from './types.ts';

/**
 * Налоговые параметры на 2026 год.
 *
 * ВАЖНО: ни одна цифра отсюда не должна попасть в код расчёта как литерал.
 * Ставки и лимиты меняются каждый год, а региональные ставки отличаются от
 * федеральных, поэтому параметры живут здесь, versioned по году, и
 * переопределяются пользователем через `rateOverridePercent`.
 *
 * Статус проверки источников (на 23.10.2026):
 *
 *   ПРОВЕРЕНО по нескольким независимым источникам:
 *     - НПД: 4% с физлиц, 6% с ИП и организаций; бонус 10 000 ₽ снижает
 *       ставки до 3% и 4% соответственно; лимит дохода 2,4 млн ₽ в год.
 *     - Взносы ИП за себя: фиксированный 57 390 ₽, 1% с дохода свыше
 *       300 000 ₽ с потолком 321 818 ₽, максимум всех взносов 379 208 ₽.
 *     - НДФЛ: пятиступенчатая шкала 13 / 15 / 18 / 20 / 22 % с порогами
 *       2,4 / 5 / 20 / 50 млн ₽; повышенная ставка применяется только к
 *       сумме превышения (176-ФЗ от 12.07.2024, п. 1 ст. 224 НК РФ).
 *     - НДС на УСН: порог освобождения снижен до 20 млн ₽ с 2026 года
 *       (425-ФЗ от 28.11.2025), основная ставка НДС — 22%.
 *
 *   ТРЕБУЕТ СВЕРКИ с НК РФ перед выпуском (отмечено TODO в коде):
 *     - Профвычет 20% для ИП на ОСН без подтверждённых расходов (ст. 221 НК РФ).
 *     - База для расчёта 1% на УСН «Доходы минус расходы» и на ОСН.
 *     - Лимит дохода для УСН на 2026 год (нашлась цифра 490,5 млн ₽ в одном источнике).
 *
 * Источники — обзоры налоговых и бухгалтерских сервисов, не официальные
 * публикации ФНС. Перед выпуском на пользователей каждую цифру сверить на
 * nalog.gov.ru и зафиксировать ссылку рядом с параметром.
 */
export const TAX_PARAMS_2026: TaxParams = {
  year: 2026,
  effectiveFrom: '2026-01-01',

  npd: {
    rateIndividualsPercent: 4,
    rateBusinessesPercent: 6,
    bonusDeductionIndividualsPercent: 1,
    bonusDeductionBusinessesPercent: 2,
    bonusTotal: rubles(10_000),
    annualIncomeLimit: rubles(2_400_000),
  },

  usnIncome: {
    ratePercent: 6,
    minRegionalRatePercent: 1,
  },

  usnIncomeMinusExpenses: {
    ratePercent: 15,
    minRegionalRatePercent: 5,
    minimumTaxPercent: 1,
  },

  osnIp: {
    bands: [
      { upTo: rubles(2_400_000), ratePercent: 13 },
      { upTo: rubles(5_000_000), ratePercent: 15 },
      { upTo: rubles(20_000_000), ratePercent: 18 },
      { upTo: rubles(50_000_000), ratePercent: 20 },
      { upTo: null, ratePercent: 22 },
    ],
    // TODO сверить со ст. 221 НК РФ перед выпуском.
    professionalDeductionPercent: 20,
  },

  contributions: {
    fixedAnnual: rubles(57_390),
    onePercentThreshold: rubles(300_000),
    onePercentRate: 1,
    onePercentCap: rubles(321_818),
    totalCap: rubles(379_208),
  },

  limits: {
    usnVatThreshold: rubles(20_000_000),
    // TODO сверить: цифра найдена в одном источнике.
    usnIncomeLimit: rubles(490_500_000),
  },
};

/**
 * Режимы налогообложения. Активны только четыре — остальные объявлены,
 * чтобы расчёт и интерфейс были готовы к ним, но выбрать их нельзя.
 */
export const REGIMES: Record<RegimeId, RegimeDefinition> = {
  npd: {
    id: 'npd',
    label: 'НПД (самозанятый)',
    hint: 'Без отчётности и взносов. Лимит дохода 2,4 млн ₽ в год, нельзя нанимать сотрудников.',
    active: true,
    expensesReduceTax: false,
    paysSelfContributions: false,
  },
  usn_income: {
    id: 'usn_income',
    label: 'УСН «Доходы»',
    hint: 'Налог с выручки. Выгоден, когда расходов мало: налог уменьшается на страховые взносы.',
    active: true,
    expensesReduceTax: false,
    paysSelfContributions: true,
    defaultRatePercent: 6,
    minRegionalRatePercent: 1,
  },
  usn_income_minus_expenses: {
    id: 'usn_income_minus_expenses',
    label: 'УСН «Доходы минус расходы»',
    hint: 'Налог с прибыли. Выгоден при расходах выше ~60% выручки. Есть минимальный налог 1% с выручки.',
    active: true,
    expensesReduceTax: true,
    paysSelfContributions: true,
    defaultRatePercent: 15,
    minRegionalRatePercent: 5,
  },
  osn_ip_ndfl: {
    id: 'osn_ip_ndfl',
    label: 'ОСН — ИП (НДФЛ)',
    hint: 'НДФЛ по прогрессивной шкале 13–22% с прибыли. Без подтверждённых расходов — профвычет 20%.',
    active: true,
    expensesReduceTax: true,
    paysSelfContributions: true,
  },

  psn: {
    id: 'psn',
    label: 'ПСН (патент)',
    hint: 'Фиксированная стоимость патента вместо налога с дохода.',
    active: false,
    expensesReduceTax: false,
    paysSelfContributions: true,
  },
  ausn: {
    id: 'ausn',
    label: 'АУСН',
    hint: 'Автоматизированная упрощёнка: налог считает ФНС по данным банка.',
    active: false,
    expensesReduceTax: true,
    paysSelfContributions: false,
  },
  eshn: {
    id: 'eshn',
    label: 'ЕСХН',
    hint: 'Для сельхозпроизводителей.',
    active: false,
    expensesReduceTax: true,
    paysSelfContributions: true,
  },
};

export function activeRegimes(): RegimeDefinition[] {
  return Object.values(REGIMES).filter((regime) => regime.active);
}
