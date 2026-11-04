import { describe, expect, it } from 'vitest';
import { findTestSpans, isTestFile } from '../../src/core/test-outline.js';

const line = (text) => ({ text });

describe('test outlines', () => {
  it('recognises test files by folder and by name', () => {
    expect(isTestFile('src/Payment.Tests/ChargeTests.cs')).toBe(true);
    expect(isTestFile('src/charge.test.ts')).toBe(true);
    expect(isTestFile('src/PaymentTests.cs')).toBe(true);
    expect(isTestFile('src/Payment.cs')).toBe(false);
  });

  it('folds each JavaScript test and leaves describe as the frame', () => {
    const lines = [
      'describe("charge", () => {',
      '  it("rejects empty amounts", () => {',
      '    expect(charge(null)).toBeNull();',
      '  });',
      '  it("captures", () => {',
      '    expect(charge(10)).toBe("ok");',
      '  });',
      '});',
    ].map(line);
    expect(findTestSpans(lines, 'js')).toEqual([
      { title: 'rejects empty amounts', start: 1, end: 3 },
      { title: 'captures', start: 4, end: 7 },
    ]);
  });

  it('keeps C# attributes with the test and reads the method name', () => {
    const lines = [
      '[Fact]',
      'public void Charge_rejects_empty()',
      '{',
      '    Assert.Null(payment.Charge(0));',
      '}',
      '[Theory]',
      '[InlineData(1)]',
      'public void Adds(int n)',
      '{',
      '}',
      '[Fact(DisplayName = "returns a receipt")]',
      'public void Charge_returns_receipt()',
      '{',
      '}',
    ].map(line);
    expect(findTestSpans(lines, 'cs').map((span) => span.title)).toEqual([
      'Charge rejects empty',
      'Adds',
      'returns a receipt',
    ]);
    expect(findTestSpans(lines, 'cs')[0]).toMatchObject({ start: 0, end: 4 });
    expect(findTestSpans(lines, 'cs')[1]).toMatchObject({ start: 5, end: 9 });
  });
});
