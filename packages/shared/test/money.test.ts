import { describe, expect, it } from 'vitest';
import {
  addMoney,
  applyMarkup,
  cmpQty,
  divRound,
  lineAmount,
  marginPercent,
  percentOf,
  subMoney,
  toPaisa,
  fromPaisa,
  addQty,
} from '../src/money';
import { ORDER_TRANSITIONS, PO_TRANSITIONS, canTransition } from '../src/workflows';

describe('money arithmetic', () => {
  it('never loses precision like floating point does', () => {
    expect(0.1 + 0.2).not.toBe(0.3);
    expect(addMoney('0.10', '0.20')).toBe('0.30');
    expect(addMoney('1000000.01', '0.99', '-0.50')).toBe('1000000.50');
    expect(subMoney('10.00', '10.01')).toBe('-0.01');
  });

  it('rounds half away from zero at the paisa', () => {
    expect(divRound(5n, 2n)).toBe(3n);
    expect(divRound(-5n, 2n)).toBe(-3n);
    expect(percentOf('289.80', '13')).toBe('37.67'); // 37.674
    expect(percentOf('32.20', '13')).toBe('4.19'); // 4.186
    expect(applyMarkup('9.50', '15')).toBe('10.93'); // 10.925
  });

  it('multiplies fractional quantities by prices exactly', () => {
    expect(lineAmount('2.500', '120.00')).toBe('300.00');
    expect(lineAmount('0.333', '100.00')).toBe('33.30');
    expect(lineAmount('1000000', '99999.99')).toBe('99999990000.00'); // beyond 2^53 paisa in intermediate math
  });

  it('rejects malformed values and excess precision', () => {
    expect(() => toPaisa('12.345')).toThrow();
    expect(() => toPaisa('abc')).toThrow();
    expect(toPaisa('12.340')).toBe(1234n);
    expect(fromPaisa(-5n)).toBe('-0.05');
  });

  it('computes margin percent, guarding zero revenue', () => {
    expect(marginPercent('1422.00', '1210.00')).toBe('14.91');
    expect(marginPercent('0.00', '10.00')).toBeNull();
  });

  it('compares and adds quantities', () => {
    expect(addQty('1.5', '2.250')).toBe('3.750');
    expect(cmpQty('2.000', '2')).toBe(0);
  });
});

describe('state machines', () => {
  it('orders cannot skip approval or leave terminal states', () => {
    expect(canTransition(ORDER_TRANSITIONS, 'draft', 'approved')).toBe(false);
    expect(canTransition(ORDER_TRANSITIONS, 'pending_approval', 'approved')).toBe(true);
    expect(canTransition(ORDER_TRANSITIONS, 'cancelled', 'draft')).toBe(false);
    expect(canTransition(ORDER_TRANSITIONS, 'delivered', 'cancelled')).toBe(false);
  });

  it('purchase orders cannot be sent before approval', () => {
    expect(canTransition(PO_TRANSITIONS, 'draft', 'sent')).toBe(false);
    expect(canTransition(PO_TRANSITIONS, 'pending_approval', 'sent')).toBe(false);
    expect(canTransition(PO_TRANSITIONS, 'approved', 'sent')).toBe(true);
  });
});
