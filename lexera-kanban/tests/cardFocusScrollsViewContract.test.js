// Real-DOM contract: focusing a card from the workspace tree (or
// any caller of orderHelpers.navigateHierarchyTargetInIframe — the
// embedded-iframe focus path the workspace shell uses to deliver
// focus targets to the kanban frame) finds the correct DOM element
// AND calls scrollIntoView on it, regardless of where the card sits
// in the column (beginning / middle / end).
//
// User contract 2026-05-11: "ADD A REAL TEST FOR THE CARD FOCUSSING
// THAT TAKES ON AT THE BEGINNING OF THE BOARD, ONE IN THE MIDDLE AND
// ONE AT THE END. THE VIEW MUST MOVE!!!"
//
// This test runs against the SAME flow the real app uses:
//   shell.focusHierarchyTarget(target, boardId)
//     → messageBridge.focusHierarchy → emit_to kanban frame
//     → embeddedBoardBridge `focus-hierarchy-target` listener
//     → dispatchAsMessage → handleEmbeddedHierarchyFocusMessage
//     → navigateHierarchyTargetInIframe(target)        ← we test from here
//     → nav.navigateToHierarchyTarget(target, options)
//     → options.focusHierarchyTargetLocally(target)
//     → findBoardEntityElement(target)
//     → el.scrollIntoView({ block: 'center', behavior: 'smooth' })
//
// The test wires findBoardEntityElement to do a real DOM query and
// asserts scrollIntoView fires on the resolved card.

import { describe, expect, it, vi } from 'vitest';
import { JSDOM } from 'jsdom';
import { loadIIFE } from './load-iife.js';

function buildKanbanDom(cardCount) {
  const dom = new JSDOM(
    '<!doctype html><html><body>' +
    '<div id="columns-container">' +
    '<div class="column" data-column-id="col-1" data-col-index="0"' +
    '     data-row-index="0" data-stack-index="0" data-col-local-index="0">' +
    '<div class="column-header">Backlog</div>' +
    '<div class="column-cards" data-col-index="0"></div>' +
    '</div>' +
    '</div>' +
    '</body></html>',
    { url: 'http://localhost/' }
  );
  const { window } = dom;
  const cardsContainer = window.document.querySelector('.column-cards');
  const cards = [];
  for (let i = 0; i < cardCount; i++) {
    const card = window.document.createElement('div');
    card.className = 'card';
    card.setAttribute('data-card-id', `crdt-100-${i}`);
    card.setAttribute('data-card-kid', `kid-${i.toString(16).padStart(2, '0')}`);
    card.setAttribute('data-col-index', '0');
    card.setAttribute('data-card-index', String(i));
    // Spy: every card has its own scrollIntoView spy.
    card.scrollIntoView = vi.fn();
    cardsContainer.appendChild(card);
    cards.push(card);
  }
  return { dom, window, cards };
}

// Loads orderHelpers in a controlled jsdom so we can drive its
// navigateHierarchyTargetInIframe directly.
function loadOrderHelpers(window, deps) {
  const helpers = loadIIFE('board/orderHelpers.js', 'LexeraOrderHelpers', {
    window,
    document: window.document
  });
  helpers.init(deps);
  return helpers;
}

// Wires a navigation api that mirrors `boardNavigation.navigateToHierarchyTarget` —
// hands the inline focusHierarchyTargetLocally callback the target and
// expects it to do the DOM lookup + scroll. The real navigation api
// has unfold steps in front; we skip those because we're not asserting
// the fold-state path here.
function makeNavApi() {
  return {
    navigateToHierarchyTarget(target, options) {
      return Promise.resolve(options.focusHierarchyTargetLocally(target));
    },
    unfoldSearchTarget() { /* noop */ }
  };
}

describe('navigateHierarchyTargetInIframe — view moves for cards at beginning / middle / end', () => {
  const CARD_COUNT = 12;

  // The dep `findBoardEntityElement` mirrors the production wiring
  // (app.js orderHelpersInitConfig wires it to boardSearch's real
  // findBoardEntityElement). We can't load all of boardSearch +
  // app.js here, so we replicate the exact query findBoardEntityElement
  // performs (kid-first, Loro id fallback) against our real DOM.
  function makeFindBoardEntityElement(container) {
    return function findBoardEntityElement(target) {
      if (!target || !target.cardId) return null;
      const escaped = String(target.cardId).replace(/"/g, '\\"');
      return container.querySelector(`.card[data-card-kid="${escaped}"]`)
        || container.querySelector(`.card[data-card-id="${escaped}"]`);
    };
  }

  function runFocus(cardIdValue) {
    const { window, cards } = buildKanbanDom(CARD_COUNT);
    const container = window.document.getElementById('columns-container');
    const focusCard = vi.fn();
    const focusBoardEntity = vi.fn();
    const orderHelpers = loadOrderHelpers(window, {
      embeddedMode: true,
      getBoardNavigationApi: () => makeNavApi(),
      getActiveBoardData: () => ({ id: 'board-1' }),
      saveFoldState: vi.fn(),
      findBoardEntityElement: makeFindBoardEntityElement(container),
      focusCard,
      focusBoardEntity
    });
    const result = orderHelpers.navigateHierarchyTargetInIframe({
      boardId: 'board-1',
      cardId: cardIdValue
    });
    return { result, cards, focusCard, focusBoardEntity };
  }

  it('focuses the FIRST card (index 0) by kid → view moves', async () => {
    const { result, cards, focusCard } = runFocus('kid-00');
    await expect(result).resolves.toBe(true);
    expect(cards[0].scrollIntoView).toHaveBeenCalledTimes(1);
    expect(cards[0].scrollIntoView).toHaveBeenCalledWith({ block: 'center', behavior: 'smooth' });
    expect(focusCard).toHaveBeenCalledWith(cards[0]);
    // Only the target card scrolls.
    for (let i = 1; i < CARD_COUNT; i++) {
      expect(cards[i].scrollIntoView).not.toHaveBeenCalled();
    }
  });

  it('focuses a MIDDLE card (index 6) by kid → view moves', async () => {
    const middleIdx = Math.floor(CARD_COUNT / 2);  // 6
    const targetKid = `kid-${middleIdx.toString(16).padStart(2, '0')}`;
    const { result, cards, focusCard } = runFocus(targetKid);
    await expect(result).resolves.toBe(true);
    expect(cards[middleIdx].scrollIntoView).toHaveBeenCalledTimes(1);
    expect(cards[middleIdx].scrollIntoView).toHaveBeenCalledWith({ block: 'center', behavior: 'smooth' });
    expect(focusCard).toHaveBeenCalledWith(cards[middleIdx]);
    expect(cards[0].scrollIntoView).not.toHaveBeenCalled();
    expect(cards[CARD_COUNT - 1].scrollIntoView).not.toHaveBeenCalled();
  });

  it('focuses the LAST card (index N-1) by kid → view moves', async () => {
    const lastIdx = CARD_COUNT - 1;
    const targetKid = `kid-${lastIdx.toString(16).padStart(2, '0')}`;
    const { result, cards, focusCard } = runFocus(targetKid);
    await expect(result).resolves.toBe(true);
    expect(cards[lastIdx].scrollIntoView).toHaveBeenCalledTimes(1);
    expect(cards[lastIdx].scrollIntoView).toHaveBeenCalledWith({ block: 'center', behavior: 'smooth' });
    expect(focusCard).toHaveBeenCalledWith(cards[lastIdx]);
    expect(cards[0].scrollIntoView).not.toHaveBeenCalled();
    expect(cards[Math.floor(CARD_COUNT / 2)].scrollIntoView).not.toHaveBeenCalled();
  });

  it('falls back from kid form to Loro-id form when the workspace tree captured the Loro id', async () => {
    const middleIdx = Math.floor(CARD_COUNT / 2);
    const targetLoroId = `crdt-100-${middleIdx}`;  // not a kid
    const { result, cards, focusCard } = runFocus(targetLoroId);
    await expect(result).resolves.toBe(true);
    expect(cards[middleIdx].scrollIntoView).toHaveBeenCalledTimes(1);
    expect(focusCard).toHaveBeenCalledWith(cards[middleIdx]);
  });

  it('returns false (and does NOT scroll) when no card matches the target id', async () => {
    const { result, cards, focusCard } = runFocus('kid-deadbeef');
    await expect(result).resolves.toBe(false);
    expect(focusCard).not.toHaveBeenCalled();
    for (let i = 0; i < CARD_COUNT; i++) {
      expect(cards[i].scrollIntoView).not.toHaveBeenCalled();
    }
  });
});
