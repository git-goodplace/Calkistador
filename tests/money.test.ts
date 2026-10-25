import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  formatMoney,
  parseRubleInput,
  percentOf,
  roundToRubles,
  rubles,
  toRubles,
} from '../src/domain/money.ts';

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

test('разбор ввода с клавиатуры', () => {
  assert.equal(parseRubleInput('1234'), rubles(1234));
  assert.equal(parseRubleInput('1234,5'), rubles(1234.5));
  assert.equal(parseRubleInput('1234.50'), rubles(1234.5));
  assert.equal(parseRubleInput('1 234'), rubles(1234));
  assert.equal(parseRubleInput('0,05'), 5);
  // одна запятая — это ещё не сумма, сохранять нечего
  assert.equal(parseRubleInput(','), null);
  // лишние знаки отбрасываются, а не округляются: на экране то, что набрано
  assert.equal(parseRubleInput('10,999'), rubles(10.99));
  assert.equal(parseRubleInput(''), null);
  assert.equal(parseRubleInput('.'), null);
  assert.equal(parseRubleInput('abc'), null);
  assert.equal(parseRubleInput('1,2,3'), null);
});
