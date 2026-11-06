import { describe, expect, it } from 'vitest';
import { mountTestOutlines } from '../../src/content/test-outline.js';

describe('mountTestOutlines', () => {
  it('folds each test behind a pill that names the line count and toggles the body', () => {
    const lines = ['    [Test]', '    public void Charges_once()', '    {', '    }'];
    const el = document.createElement('article');
    el.dataset.qa = 'branch-diff-file';
    el.setAttribute('aria-label', 'Diff of file src/Payment.Tests/ChargeTests.cs');
    el.innerHTML = lines
      .map((text) => `<div data-key="code-line" role="row"><span role="gridcell" data-line-type="+">${text}</span></div>`)
      .join('');
    document.body.append(el);
    mountTestOutlines(document);

    const fold = el.querySelector('.bbrd-test-fold');
    const rows = [...el.querySelectorAll('[data-key="code-line"]')];
    expect(fold.querySelector('.bbrd-fold-pill').textContent).toBe('Test - 4 lines');
    expect(fold.querySelector('.bbrd-test-title').textContent).toBe('Charges once');
    expect(fold.title).toBe('Charges once (+4 −0)');
    expect(fold.getAttribute('aria-expanded')).toBe('false');
    expect(rows.every((row) => row.classList.contains('bbrd-test-collapsed'))).toBe(true);

    fold.click();
    expect(fold.getAttribute('aria-expanded')).toBe('true');
    expect(rows.some((row) => row.classList.contains('bbrd-test-collapsed'))).toBe(false);

    fold.click();
    expect(rows.every((row) => row.classList.contains('bbrd-test-collapsed'))).toBe(true);
    el.remove();
  });
});
