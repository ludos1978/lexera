import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { JSDOM } from 'jsdom';
import { describe, expect, it } from 'vitest';

const __dirname = dirname(fileURLToPath(import.meta.url));
const appCss = readFileSync(resolve(__dirname, '..', 'src', 'app.css'), 'utf8');
const dragHandlersJs = readFileSync(resolve(__dirname, '..', 'src', 'dragdrop', 'dragDropHandlers.js'), 'utf8');

describe('card-drag layout contract', () => {
  it('removes the dragging source card from layout flow so the drop indicator aligns with the post-drop position', () => {
    // The drop indicator is rendered at `top of cards[insertIdx]` among
    // `.card:not(.dragging)`. If the source still occupied its slot, the
    // indicator would be drawn one card-height BELOW where the dropped
    // card actually lands (cards above shift up after the source is
    // removed). Pulling the source out of layout flow makes the
    // indicator's source-excluded view of the world match the final
    // result. Implementations that meet this contract: `display: none`,
    // `position: absolute` (out of flow), or `height: 0; overflow: hidden`.
    const cardDraggingRule = appCss.match(/\.card\.dragging\s*\{([^}]*)\}/);
    expect(cardDraggingRule, '.card.dragging CSS rule must exist').toBeTruthy();
    const body = cardDraggingRule[1];
    const removesFromFlow =
      /display\s*:\s*none/i.test(body) ||
      /position\s*:\s*absolute/i.test(body) ||
      /position\s*:\s*fixed/i.test(body) ||
      /height\s*:\s*0\b/i.test(body);
    expect(
      removesFromFlow,
      '.card.dragging must remove the source from layout flow (display:none, position:absolute, or height:0) so the drop indicator matches the result'
    ).toBe(true);
  });

  it('runtime: an actual .card.dragging element resolves to a layout-flow-removing computed style', () => {
    // Runtime sibling to the regex assertion above. Loads app.css into a
    // jsdom document, mounts a `.card.dragging` node, and reads
    // `getComputedStyle` — catches drift the regex layer could miss
    // (e.g. a rule shadowed by a later more-specific selector that
    // re-enables `display: block` in some board context).
    const dom = new JSDOM(
      '<!doctype html><html><head><style>' + appCss + '</style></head>' +
      '<body><div class="board"><div class="card-list">' +
      '<div class="card dragging" id="src"></div>' +
      '<div class="card" id="other"></div>' +
      '</div></div></body></html>'
    );
    const src = dom.window.document.getElementById('src');
    const cs = dom.window.getComputedStyle(src);
    const removesFromFlow =
      cs.display === 'none' ||
      cs.position === 'absolute' ||
      cs.position === 'fixed' ||
      cs.height === '0px';
    expect(
      removesFromFlow,
      'computed style of a real .card.dragging element must remove it from layout flow ' +
      '(display=' + cs.display + ', position=' + cs.position + ', height=' + cs.height + ')'
    ).toBe(true);
  });

  it('keeps the same-column +=1 adjustment so insertIdx maps from source-excluded to source-included space', () => {
    // The source is excluded from `findCardInsertIndex`'s `.card:not(.dragging)`
    // query, so its insertIdx counts in the source-EXCLUDED visible space.
    // `moveCard.resolveInsertCardIndex` operates on the live column data
    // (still source-INCLUDED). For same-column drops past the source's
    // index we must re-add 1 to translate between the spaces — without
    // this the splice/decrement combo in moveCard would land the card
    // one slot too high. This pairs with the `.card.dragging` layout
    // change above: the CSS keeps the visual indicator aligned with
    // the result, while this JS keeps the data math correct.
    expect(dragHandlersJs).toContain('target.insertIdx > source.cardIndex');
    expect(dragHandlersJs).toContain('target.insertIdx += 1');
  });
});
