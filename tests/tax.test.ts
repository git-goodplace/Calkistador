import assert from 'node:assert/strict';
import { test } from 'node:test';

import { rubles } from '../src/domain/money.ts';
import { InactiveRegimeError, calculateTax } from '../src/domain/tax/calculate.ts';
import { TAX_PARAMS_2026, activeRegimes } from '../src/domain/tax/params-2026.ts';
import type { RegimeId, TaxInput } from '../src/domain/tax/types.ts';

function input(regime: RegimeId, overrides: Partial<TaxInput> = {}): TaxInput {
  return {
    regime,
    incomeFromIndividuals: 0,
    incomeFromBusinesses: 0,
    deductibleExpenses: 0,
    monthsRegistered: 12,
    npdBonusRemaining: 0,
    ...overrides,
  };
}

test('активны ровно четыре режима, и это заданные четыре', () => {
  const ids = activeRegimes().map((regime) => regime.id);
  assert.deepEqual(ids, ['npd', 'usn_income', 'usn_income_minus_expenses', 'osn_ip_ndfl']);
});

test('выключенный режим не считается, а падает с понятной ошибкой', () => {
  assert.throws(() => calculateTax(input('psn')), InactiveRegimeError);
  assert.throws(() => calculateTax(input('ausn')), InactiveRegimeError);
});

test('НПД: 4% с физлиц, 6% с бизнеса, взносов нет', () => {
  const result = calculateTax(
    input('npd', {
      incomeFromIndividuals: rubles(100_000),
      incomeFromBusinesses: rubles(100_000),
    }),
  );
  assert.equal(result.tax, rubles(10_000)); // 4 000 + 6 000
  assert.equal(result.contributionsTotal, 0);
  assert.equal(result.totalBurden, rubles(10_000));
  assert.equal(result.effectiveRatePercent, 5);
});

test('НПД: бонус 10 000 ₽ снижает ставки на 1 и 2 п.п.', () => {
  const result = calculateTax(
    input('npd', {
      incomeFromIndividuals: rubles(100_000),
      incomeFromBusinesses: rubles(100_000),
      npdBonusRemaining: rubles(10_000),
    }),
  );
  // Вычет: 1% от 100 000 + 2% от 100 000 = 3 000
  assert.equal(result.tax, rubles(7_000));
});

test('НПД: вычет ограничен остатком бонуса', () => {
  const result = calculateTax(
    input('npd', {
      incomeFromIndividuals: rubles(100_000),
      incomeFromBusinesses: rubles(100_000),
      npdBonusRemaining: rubles(500),
    }),
  );
  assert.equal(result.tax, rubles(9_500));
});

test('НПД: превышение лимита 2,4 млн даёт предупреждение', () => {
  const result = calculateTax(
    input('npd', { incomeFromIndividuals: rubles(3_000_000) }),
  );
  assert.equal(result.warnings.length, 1);
  assert.match(result.warnings[0], /лимит НПД/);
});

test('УСН «Доходы»: взносы съедают налог полностью у ИП без работников', () => {
  const result = calculateTax(input('usn_income', { incomeFromBusinesses: rubles(1_000_000) }));
  assert.equal(result.contributionsFixed, rubles(57_390));
  assert.equal(result.contributionsOnePercent, rubles(7_000)); // 1% с 700 000
  assert.equal(result.contributionsTotal, rubles(64_390));
  assert.equal(result.tax, 0); // налог 60 000 полностью уменьшен на взносы
  assert.equal(result.totalBurden, rubles(64_390));
  assert.equal(result.effectiveRatePercent, 6.4);
});

test('УСН «Доходы»: с работниками налог уменьшается только наполовину', () => {
  const result = calculateTax(
    input('usn_income', { incomeFromBusinesses: rubles(1_000_000), hasEmployees: true }),
  );
  assert.equal(result.tax, rubles(30_000));
  assert.equal(result.totalBurden, rubles(94_390));
});

test('УСН «Доходы»: взносы упираются в годовой потолок', () => {
  const result = calculateTax(
    input('usn_income', { incomeFromBusinesses: rubles(100_000_000) }),
  );
  assert.equal(result.contributionsOnePercent, TAX_PARAMS_2026.contributions.onePercentCap);
  assert.equal(result.contributionsTotal, TAX_PARAMS_2026.contributions.totalCap);
  assert.equal(result.tax, rubles(6_000_000 - 379_208));
  assert.ok(result.warnings.some((w) => /НДС/.test(w)));
});

test('УСН «Доходы»: неполный год — фиксированный взнос пропорционально', () => {
  const result = calculateTax(input('usn_income', { monthsRegistered: 6 }));
  assert.equal(result.contributionsFixed, rubles(28_695));
  assert.equal(result.tax, 0);
  assert.equal(result.totalBurden, rubles(28_695));
  assert.equal(result.effectiveRatePercent, 0);
});

test('УСН «Доходы минус расходы»: база за вычетом расходов и взносов', () => {
  const result = calculateTax(
    input('usn_income_minus_expenses', {
      incomeFromBusinesses: rubles(2_000_000),
      deductibleExpenses: rubles(1_200_000),
    }),
  );
  assert.equal(result.contributionsOnePercent, rubles(5_000)); // 1% с (800 000 − 300 000)
  assert.equal(result.contributionsTotal, rubles(62_390));
  assert.equal(result.taxableBase, rubles(737_610));
  assert.equal(result.tax, rubles(110_642)); // 15% с округлением до рубля
  assert.equal(result.totalBurden, rubles(173_032));
});

test('УСН «Доходы минус расходы»: при низкой прибыли платится минимальный налог', () => {
  const result = calculateTax(
    input('usn_income_minus_expenses', {
      incomeFromBusinesses: rubles(1_000_000),
      deductibleExpenses: rubles(990_000),
    }),
  );
  assert.equal(result.taxableBase, 0);
  assert.equal(result.tax, rubles(10_000)); // 1% от выручки
  assert.ok(result.warnings.some((w) => /минимальный налог/i.test(w)));
});

test('ОСН ИП: одна ступень НДФЛ, пока база ниже 2,4 млн', () => {
  const result = calculateTax(
    input('osn_ip_ndfl', {
      incomeFromBusinesses: rubles(3_000_000),
      deductibleExpenses: rubles(1_000_000),
    }),
  );
  assert.equal(result.contributionsTotal, rubles(74_390));
  assert.equal(result.taxableBase, rubles(1_925_610));
  assert.equal(result.tax, rubles(250_329)); // 13%
  assert.equal(result.breakdown.filter((line) => line.label.includes('НДФЛ')).length, 1);
});

test('ОСН ИП: профвычет 20% и две ступени шкалы', () => {
  const result = calculateTax(
    input('osn_ip_ndfl', {
      incomeFromBusinesses: rubles(6_000_000),
      useProfessionalDeduction: true,
    }),
  );
  assert.equal(result.contributionsOnePercent, rubles(45_000));
  assert.equal(result.taxableBase, rubles(4_697_610));
  // 13% с 2 400 000 = 312 000, затем 15% с остатка 2 297 610 = 344 641,50
  assert.equal(result.tax, rubles(656_642));
  const ndflLines = result.breakdown.filter((line) => line.label.includes('НДФЛ'));
  assert.equal(ndflLines.length, 2);
});

test('ОСН ИП: профвычет меньше подтверждённых расходов — предупреждаем', () => {
  const result = calculateTax(
    input('osn_ip_ndfl', {
      incomeFromBusinesses: rubles(1_000_000),
      deductibleExpenses: rubles(800_000),
      useProfessionalDeduction: true,
    }),
  );
  assert.ok(result.warnings.some((w) => /выгоднее выключить профвычет/.test(w)));
});

test('ОСН ИП: зарплата сдвигает доход бизнеса на следующую ступень', () => {
  const result = calculateTax(
    input('osn_ip_ndfl', {
      incomeFromBusinesses: rubles(1_000_000),
      otherNdflIncome: rubles(2_400_000),
    }),
  );
  assert.equal(result.taxableBase, rubles(935_610));
  // Первая ступень уже израсходована зарплатой, поэтому весь доход по 15%
  assert.equal(result.tax, rubles(140_342));
  const ndflLines = result.breakdown.filter((line) => line.label.includes('НДФЛ'));
  assert.equal(ndflLines.length, 1);
  assert.match(ndflLines[0].label, /15%/);
  assert.ok(result.warnings.some((w) => /совокупного годового дохода/.test(w)));
});

test('расшифровка расчёта не бывает пустой — на ней держится доверие к цифре', () => {
  for (const regime of activeRegimes()) {
    const result = calculateTax(
      input(regime.id, {
        incomeFromIndividuals: rubles(500_000),
        incomeFromBusinesses: rubles(500_000),
        deductibleExpenses: rubles(100_000),
      }),
    );
    assert.ok(result.breakdown.length > 0, `пустая расшифровка у ${regime.id}`);
    assert.ok(result.totalBurden >= 0, `отрицательная нагрузка у ${regime.id}`);
  }
});

test('нулевой доход не ломает расчёт ни на одном режиме', () => {
  for (const regime of activeRegimes()) {
    const result = calculateTax(input(regime.id, { monthsRegistered: 0 }));
    assert.equal(result.tax, 0);
    assert.equal(result.effectiveRatePercent, 0);
  }
});
