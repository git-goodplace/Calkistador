import assert from 'node:assert/strict';
import { test } from 'node:test';

import { formatMoney, percentOf, roundToRubles, rubles, toRubles } from '../src/domain/money.ts';

test('рубли переводятся в копейки без потери точности', () => {
  assert.equal(rubles(0.1) + rubles(0.2), rubles(0.3));
  assert.equal(rubles(1234.56), 123456);
  assert.equal(toRubles(123456), 1234.56);
});

test('процент от суммы округляется до копейки', () => {
  assert.equal(percentOf(rubles(100), 6), rubles(6));
  assert.equal(percentOf(rubles(333.33), 1), 333);
  assert.equal(percentOf(rubles(-100), 6), rubles(-6));
});

test('налог округляется до целых рублей', () => {
  assert.equal(roundToRubles(123456), rubles(1235));
  assert.equal(roundToRubles(123444), rubles(1234));
});

test('формат денег: разряды, копейки, знак', () => {
  assert.equal(formatMoney(rubles(1234567.89)), '1 234 567,89 ₽');
  assert.equal(formatMoney(rubles(-500)), '−500,00 ₽');
  assert.equal(formatMoney(rubles(500), { withSign: true }), '+500,00 ₽');
  assert.equal(formatMoney(5), '0,05 ₽');
});
