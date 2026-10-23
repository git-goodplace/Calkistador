import { clampToZero, formatMoney, percentOf, roundToRubles } from '../money.ts';
import type { Kopecks } from '../money.ts';
import { REGIMES, TAX_PARAMS_2026 } from './params-2026.ts';
import type { BreakdownLine, TaxInput, TaxParams, TaxResult } from './types.ts';

export class InactiveRegimeError extends Error {
  // Поле объявлено явно: Node в strip-only режиме не поддерживает
  // parameter properties, а собирать проект ради домена не хочется.
  readonly regime: string;

  constructor(regime: string) {
    super(`Налоговый режим «${regime}» объявлен, но не активен`);
    this.name = 'InactiveRegimeError';
    this.regime = regime;
  }
}

/** Фиксированный взнос пропорционально месяцам на учёте. */
function fixedContributions(input: TaxInput, params: TaxParams): Kopecks {
  const months = Math.min(12, Math.max(0, Math.trunc(input.monthsRegistered)));
  if (months === 0) return 0;
  return Math.round((params.contributions.fixedAnnual * months) / 12);
}

/** Дополнительный взнос 1% с суммы базы свыше порога, с потолком. */
function onePercentContribution(base: Kopecks, params: TaxParams): Kopecks {
  const { onePercentThreshold, onePercentRate, onePercentCap } = params.contributions;
  const excess = clampToZero(base - onePercentThreshold);
  return Math.min(percentOf(excess, onePercentRate), onePercentCap);
}

/** НДФЛ по прогрессивной шкале: повышенная ставка только на сумму превышения. */
function progressiveTax(
  base: Kopecks,
  alreadyTaxedIncome: Kopecks,
  params: TaxParams,
): { tax: Kopecks; lines: BreakdownLine[] } {
  const lines: BreakdownLine[] = [];
  if (base <= 0) return { tax: 0, lines };

  let tax = 0;
  // Прочий доход, уже обложенный НДФЛ, сдвигает нас вверх по шкале:
  // ступени считаются от совокупного дохода за год, а не от одного источника.
  let consumed = clampToZero(alreadyTaxedIncome);
  let remaining = base;
  let lowerBound = consumed;

  for (const band of params.osnIp.bands) {
    if (remaining <= 0) break;
    const bandCapacity = band.upTo === null ? Infinity : band.upTo - consumed;
    if (bandCapacity <= 0) {
      continue;
    }
    const inBand = Math.min(remaining, bandCapacity);
    const bandTax = percentOf(inBand, band.ratePercent);
    tax += bandTax;
    lines.push({
      label:
        `НДФЛ ${band.ratePercent}% с ${formatMoney(inBand)}` +
        (band.upTo === null
          ? ` (свыше ${formatMoney(lowerBound)})`
          : ` (ступень до ${formatMoney(band.upTo)})`),
      amount: bandTax,
    });
    remaining -= inBand;
    consumed += inBand;
    lowerBound = consumed;
  }

  return { tax, lines };
}

/**
 * Налоговая нагрузка бизнес-контура за период.
 *
 * Возвращает не только сумму, но и построчную расшифровку: пользователь
 * должен видеть, из чего собралась цифра, иначе он ей не поверит.
 */
export function calculateTax(input: TaxInput, params: TaxParams = TAX_PARAMS_2026): TaxResult {
  const regime = REGIMES[input.regime];
  if (!regime) throw new InactiveRegimeError(input.regime);
  if (!regime.active) throw new InactiveRegimeError(regime.label);

  const totalIncome = input.incomeFromIndividuals + input.incomeFromBusinesses;
  const breakdown: BreakdownLine[] = [];
  const warnings: string[] = [];

  let taxableBase = 0;
  let tax = 0;
  let contributionsFixed = 0;
  let contributionsOnePercent = 0;

  if (input.regime === 'npd') {
    const { npd } = params;
    taxableBase = totalIncome;

    const taxIndividuals = percentOf(input.incomeFromIndividuals, npd.rateIndividualsPercent);
    const taxBusinesses = percentOf(input.incomeFromBusinesses, npd.rateBusinessesPercent);
    breakdown.push(
      {
        label: `Налог ${npd.rateIndividualsPercent}% с дохода от физлиц`,
        amount: taxIndividuals,
      },
      {
        label: `Налог ${npd.rateBusinessesPercent}% с дохода от ИП и организаций`,
        amount: taxBusinesses,
      },
    );

    // Бонус 10 000 ₽ уменьшает начисленный налог, а не доход:
    // 1 п.п. по доходам от физлиц и 2 п.п. по доходам от бизнеса.
    const possibleDeduction =
      percentOf(input.incomeFromIndividuals, npd.bonusDeductionIndividualsPercent) +
      percentOf(input.incomeFromBusinesses, npd.bonusDeductionBusinessesPercent);
    const deduction = Math.min(possibleDeduction, clampToZero(input.npdBonusRemaining));
    if (deduction > 0) {
      breakdown.push({ label: 'Бонус НПД (вычет из налога)', amount: deduction, negative: true });
    }

    tax = roundToRubles(clampToZero(taxIndividuals + taxBusinesses - deduction));

    if (totalIncome > npd.annualIncomeLimit) {
      warnings.push(
        `Доход превысил лимит НПД ${formatMoney(npd.annualIncomeLimit)} — право на режим утрачено, ` +
          `нужно переходить на УСН или ОСН. Расчёт ниже лимит не учитывает.`,
      );
    }
  } else {
    // Все остальные активные режимы — ИП, который платит взносы за себя.
    contributionsFixed = regime.paysSelfContributions ? fixedContributions(input, params) : 0;

    const deduction = resolveDeduction(input, params, warnings);

    if (input.regime === 'usn_income') {
      const rate = input.rateOverridePercent ?? params.usnIncome.ratePercent;
      warnIfRateBelowRegionalFloor(rate, params.usnIncome.minRegionalRatePercent, warnings);

      taxableBase = totalIncome;
      // TODO сверить с НК РФ: база для 1% на УСН «Доходы» — весь доход.
      contributionsOnePercent = onePercentContribution(totalIncome, params);
      const contributionsTotal = capContributions(
        contributionsFixed + contributionsOnePercent,
        params,
      );

      const grossTax = percentOf(taxableBase, rate);
      breakdown.push({ label: `Налог ${rate}% с дохода`, amount: grossTax });

      // ИП без работников уменьшает налог на взносы до 100%, с работниками — до 50%.
      const reductionLimitPercent = input.hasEmployees ? 50 : 100;
      const maxReduction = percentOf(grossTax, reductionLimitPercent);
      const reduction = Math.min(contributionsTotal, maxReduction);
      if (reduction > 0) {
        breakdown.push({
          label: `Уменьшение налога на страховые взносы (до ${reductionLimitPercent}%)`,
          amount: reduction,
          negative: true,
        });
      }
      tax = roundToRubles(clampToZero(grossTax - reduction));
    } else if (input.regime === 'usn_income_minus_expenses') {
      const rate = input.rateOverridePercent ?? params.usnIncomeMinusExpenses.ratePercent;
      warnIfRateBelowRegionalFloor(
        rate,
        params.usnIncomeMinusExpenses.minRegionalRatePercent,
        warnings,
      );

      // Взносы входят в расходы и уменьшают базу.
      // TODO сверить с НК РФ: база для 1% здесь — доходы минус расходы.
      const baseForOnePercent = clampToZero(totalIncome - deduction);
      contributionsOnePercent = onePercentContribution(baseForOnePercent, params);
      const contributionsTotal = capContributions(
        contributionsFixed + contributionsOnePercent,
        params,
      );

      taxableBase = clampToZero(totalIncome - deduction - contributionsTotal);
      breakdown.push(
        { label: 'Доход', amount: totalIncome },
        { label: 'Расходы к вычету', amount: deduction, negative: true },
        { label: 'Страховые взносы в расходах', amount: contributionsTotal, negative: true },
      );

      const regularTax = percentOf(taxableBase, rate);
      const minimumTax = percentOf(totalIncome, params.usnIncomeMinusExpenses.minimumTaxPercent);
      breakdown.push({ label: `Налог ${rate}% с прибыли`, amount: regularTax });

      if (minimumTax > regularTax) {
        breakdown.push({
          label: `Минимальный налог ${params.usnIncomeMinusExpenses.minimumTaxPercent}% с дохода — он больше`,
          amount: minimumTax,
        });
        warnings.push(
          'Применён минимальный налог: он выше расчётного. Так бывает при убытке или низкой прибыли.',
        );
      }
      tax = roundToRubles(Math.max(regularTax, minimumTax));
    } else if (input.regime === 'osn_ip_ndfl') {
      // TODO сверить со ст. 221 НК РФ: вычитаются ли взносы сверх профвычета 20%.
      const baseForOnePercent = clampToZero(totalIncome - deduction);
      contributionsOnePercent = onePercentContribution(baseForOnePercent, params);
      const contributionsTotal = capContributions(
        contributionsFixed + contributionsOnePercent,
        params,
      );

      taxableBase = clampToZero(totalIncome - deduction - contributionsTotal);
      breakdown.push(
        { label: 'Доход', amount: totalIncome },
        {
          label: input.useProfessionalDeduction
            ? `Профвычет ${params.osnIp.professionalDeductionPercent}% от дохода`
            : 'Расходы к вычету',
          amount: deduction,
          negative: true,
        },
        { label: 'Страховые взносы в расходах', amount: contributionsTotal, negative: true },
      );

      const { tax: ndfl, lines } = progressiveTax(
        taxableBase,
        input.otherNdflIncome ?? 0,
        params,
      );
      breakdown.push(...lines);
      tax = roundToRubles(ndfl);

      if ((input.otherNdflIncome ?? 0) > 0) {
        warnings.push(
          'Шкала НДФЛ считается от совокупного годового дохода. Зарплата и другие доходы, ' +
            'обложенные НДФЛ, учтены — они сдвигают доход бизнеса на более высокую ступень.',
        );
      }
    }

    const contributionsTotal = capContributions(
      contributionsFixed + contributionsOnePercent,
      params,
    );
    if (contributionsTotal > 0) {
      breakdown.push({
        label: 'Страховые взносы за себя (к уплате)',
        amount: contributionsTotal,
      });
    }

    if (totalIncome > params.limits.usnVatThreshold && input.regime.startsWith('usn')) {
      warnings.push(
        `Доход превысил ${formatMoney(params.limits.usnVatThreshold)} — на УСН возникает НДС. ` +
          'Расчёт НДС в приложении пока не реализован.',
      );
    }
    if (totalIncome > params.limits.usnIncomeLimit && input.regime.startsWith('usn')) {
      warnings.push(
        `Доход превысил лимит УСН ${formatMoney(params.limits.usnIncomeLimit)} — право на режим утрачено.`,
      );
    }
  }

  const contributionsTotal = capContributions(contributionsFixed + contributionsOnePercent, params);
  const totalBurden = tax + contributionsTotal;

  return {
    regime: input.regime,
    taxableBase,
    tax,
    contributionsFixed,
    contributionsOnePercent,
    contributionsTotal,
    totalBurden,
    effectiveRatePercent:
      totalIncome > 0 ? Math.round((totalBurden / totalIncome) * 1000) / 10 : 0,
    breakdown,
    warnings,
  };
}

function resolveDeduction(input: TaxInput, params: TaxParams, warnings: string[]): Kopecks {
  const regime = REGIMES[input.regime];
  if (!regime.expensesReduceTax) return 0;

  if (input.regime === 'osn_ip_ndfl' && input.useProfessionalDeduction) {
    const totalIncome = input.incomeFromIndividuals + input.incomeFromBusinesses;
    const professional = percentOf(totalIncome, params.osnIp.professionalDeductionPercent);
    if (input.deductibleExpenses > professional) {
      warnings.push(
        `Подтверждённые расходы (${formatMoney(input.deductibleExpenses)}) больше профвычета ` +
          `${formatMoney(professional)} — выгоднее выключить профвычет.`,
      );
    }
    return professional;
  }
  return clampToZero(input.deductibleExpenses);
}

function capContributions(value: Kopecks, params: TaxParams): Kopecks {
  return Math.min(value, params.contributions.totalCap);
}

function warnIfRateBelowRegionalFloor(rate: number, floor: number, warnings: string[]): void {
  if (rate < floor) {
    warnings.push(
      `Ставка ${rate}% ниже минимальной региональной ${floor}% — проверьте закон своего региона.`,
    );
  }
}
