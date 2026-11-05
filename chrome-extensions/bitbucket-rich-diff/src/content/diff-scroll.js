const wired = new WeakSet();

/**
 * Bitbucket's diff chunk scrolls sideways (`overflow-x: auto`) and clips vertically
 * (`overflow-y: hidden`). A trackpad flick over a test or summary bar latches onto that
 * chunk, which cannot move vertically, so the gesture rubber-bands. Hand the vertical
 * part to the page scroller instead.
 * @param {Document} [doc]
 */
export function installDiffWheel(doc = document) {
  if (wired.has(doc)) return;
  wired.add(doc);
  doc.addEventListener('wheel', passDiffWheel, { capture: true, passive: false });
}

/** @param {WheelEvent} event */
export function passDiffWheel(event) {
  if (event.ctrlKey) return;
  const target = event.target instanceof Element ? event.target : null;
  const trap = target?.closest('.diff-chunk, .chunks-wrapper');
  if (!trap) return;
  if (Math.abs(event.deltaY) < Math.abs(event.deltaX)) return;
  if (trap.scrollHeight > trap.clientHeight + 1) return;
  const scroller = verticalScroller(trap);
  if (!scroller) return;
  scroller.scrollTop += event.deltaY;
  event.preventDefault();
}

/** @param {Element} start */
function verticalScroller(start) {
  const view = start.ownerDocument.defaultView;
  let node = start.parentElement;
  while (node) {
    const overflow = view?.getComputedStyle(node).overflowY;
    if ((overflow === 'auto' || overflow === 'scroll' || overflow === 'overlay') && node.scrollHeight > node.clientHeight + 1) return node;
    node = node.parentElement;
  }
  return null;
}
