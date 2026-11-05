import { describe, expect, it } from 'vitest';
import { installDiffWheel } from '../../src/content/diff-scroll.js';

function pageWithChunk() {
  document.body.innerHTML = `
    <div id="page" style="overflow-y: auto">
      <div class="diff-chunk" style="overflow-x: auto; overflow-y: hidden">
        <button class="bbrd-test-fold">An entry names the queue</button>
      </div>
    </div>`;
  const page = document.getElementById('page');
  const chunk = document.querySelector('.diff-chunk');
  let top = 0;
  Object.defineProperty(chunk, 'scrollHeight', { configurable: true, value: 48 });
  Object.defineProperty(chunk, 'clientHeight', { configurable: true, value: 48 });
  Object.defineProperty(page, 'scrollHeight', { configurable: true, value: 900 });
  Object.defineProperty(page, 'clientHeight', { configurable: true, value: 200 });
  Object.defineProperty(page, 'scrollTop', {
    configurable: true,
    get() { return top; },
    set(value) { top = value; },
  });
  return { page, chunk };
}

describe('diff wheel', () => {
  it('moves the page when a vertical wheel lands on a test bar inside the diff chunk', () => {
    const { page } = pageWithChunk();
    installDiffWheel(document);
    const event = new WheelEvent('wheel', { deltaY: 80, deltaX: 4, bubbles: true, cancelable: true });
    document.querySelector('.bbrd-test-fold').dispatchEvent(event);
    expect(event.defaultPrevented).toBe(true);
    expect(page.scrollTop).toBe(80);
  });

  it('leaves a sideways gesture on the diff chunk', () => {
    pageWithChunk();
    installDiffWheel(document);
    const event = new WheelEvent('wheel', { deltaY: 2, deltaX: 40, bubbles: true, cancelable: true });
    document.querySelector('.bbrd-test-fold').dispatchEvent(event);
    expect(event.defaultPrevented).toBe(false);
  });
});
