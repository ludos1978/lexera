// @vitest-environment jsdom

/**
 * Burger-menu reveal handlers route to the right DOM target
 *
 * The card / column / row / stack burger menus expose a "Reveal hidden
 * content" entry that is supposed to flip the `data-hidden-revealed`
 * attribute on the matching DOM nodes — NOT mutate board data. A
 * regression where these handlers became data-only would silently
 * un-hide cards in the model while leaving the rendered DOM still
 * obscured (or vice-versa). These tests pin the DOM-target behaviour
 * for each scope and prove the handlers are idempotent toggles.
 */

import { beforeEach, describe, expect, it } from 'vitest';
import { loadIIFE } from './load-iife.js';

function loadColumnContextMenu() {
  return loadIIFE('menu/columnContextMenu.js', 'LexeraColumnContextMenu', {
    window,
    document,
    structuredClone,
    setTimeout,
    clearTimeout
  });
}

function buildBoardDom({ rows }) {
  const container = document.createElement('div');
  container.className = 'columns-container';
  let flatColIdx = 0;
  rows.forEach((row, rIdx) => {
    const rowEl = document.createElement('div');
    rowEl.className = 'kanban-row';
    rowEl.setAttribute('data-row-index', String(rIdx));
    (row.stacks || []).forEach((stack, sIdx) => {
      const stackEl = document.createElement('div');
      stackEl.className = 'kanban-column-stack';
      stackEl.setAttribute('data-stack-index', String(sIdx));
      (stack.columns || []).forEach((col) => {
        const colEl = document.createElement('div');
        colEl.className = 'column';
        colEl.setAttribute('data-col-index', String(flatColIdx));
        (col.cards || []).forEach((card, kIdx) => {
          const cardEl = document.createElement('div');
          cardEl.className = 'card';
          cardEl.setAttribute('data-col-index', String(flatColIdx));
          cardEl.setAttribute('data-card-index', String(kIdx));
          cardEl.setAttribute('data-card-id', card.id);
          colEl.appendChild(cardEl);
        });
        stackEl.appendChild(colEl);
        flatColIdx += 1;
      });
      rowEl.appendChild(stackEl);
    });
    container.appendChild(rowEl);
  });
  document.body.appendChild(container);
  return container;
}

function makeBoard(rows) { return { rows }; }
function makeRow(stacks) { return { stacks }; }
function makeStack(columns) { return { columns }; }
function makeCol(cards) { return { cards }; }
function makeCard(id) { return { id }; }

describe('burger-menu reveal handlers route to DOM targets', () => {
  let ColumnContextMenu;
  let container;

  beforeEach(() => {
    document.body.innerHTML = '';
    ColumnContextMenu = loadColumnContextMenu();
    container = buildBoardDom({
      rows: [
        makeRow([
          makeStack([
            makeCol([makeCard('a'), makeCard('b'), makeCard('c')]),
            makeCol([makeCard('d'), makeCard('e')])
          ]),
          makeStack([
            makeCol([makeCard('f'), makeCard('g')])
          ])
        ]),
        makeRow([
          makeStack([
            makeCol([makeCard('h'), makeCard('i')])
          ])
        ])
      ]
    });
    ColumnContextMenu.init({
      getElColumnsContainer: () => container
    });
  });

  it('revealCardContent flips data-hidden-revealed on exactly one card and is idempotent', () => {
    const card = container.querySelector('.card[data-col-index="0"][data-card-index="1"]');
    expect(card.hasAttribute('data-hidden-revealed')).toBe(false);

    ColumnContextMenu.revealCardContent(0, 1);
    expect(card.hasAttribute('data-hidden-revealed')).toBe(true);
    // Sibling cards must not have been touched.
    expect(container.querySelector('.card[data-col-index="0"][data-card-index="0"]').hasAttribute('data-hidden-revealed')).toBe(false);
    expect(container.querySelector('.card[data-col-index="0"][data-card-index="2"]').hasAttribute('data-hidden-revealed')).toBe(false);

    ColumnContextMenu.revealCardContent(0, 1);
    expect(card.hasAttribute('data-hidden-revealed')).toBe(false);
  });

  it('revealCardContent is a no-op when the card is not in the DOM', () => {
    expect(() => ColumnContextMenu.revealCardContent(0, 99)).not.toThrow();
    // Existing cards untouched.
    Array.from(container.querySelectorAll('.card')).forEach((el) => {
      expect(el.hasAttribute('data-hidden-revealed')).toBe(false);
    });
  });

  it('revealColumnContent toggles every card in the targeted column only', () => {
    ColumnContextMenu.revealColumnContent(1);
    // Column 1 has cards d, e — both revealed.
    expect(container.querySelectorAll('.card[data-col-index="1"][data-hidden-revealed]').length).toBe(2);
    // Other columns untouched.
    expect(container.querySelectorAll('.card[data-col-index="0"][data-hidden-revealed]').length).toBe(0);
    expect(container.querySelectorAll('.card[data-col-index="2"][data-hidden-revealed]').length).toBe(0);

    // Idempotent toggle: second call clears them again.
    ColumnContextMenu.revealColumnContent(1);
    expect(container.querySelectorAll('.card[data-col-index="1"][data-hidden-revealed]').length).toBe(0);
  });

  it('revealColumnContent normalises a partially-revealed column to all-revealed before toggling off', () => {
    // Manually mark only one card as revealed.
    const oneCard = container.querySelector('.card[data-col-index="1"][data-card-index="0"]');
    oneCard.setAttribute('data-hidden-revealed', '');
    expect(container.querySelectorAll('.card[data-col-index="1"][data-hidden-revealed]').length).toBe(1);

    // First reveal → flip everyone to revealed (since not all were).
    ColumnContextMenu.revealColumnContent(1);
    expect(container.querySelectorAll('.card[data-col-index="1"][data-hidden-revealed]').length).toBe(2);

    // Second reveal → clear all.
    ColumnContextMenu.revealColumnContent(1);
    expect(container.querySelectorAll('.card[data-col-index="1"][data-hidden-revealed]').length).toBe(0);
  });

  it('revealRowContent only touches cards inside the matching .kanban-row', () => {
    ColumnContextMenu.revealRowContent(0);
    // Row 0 has 7 cards across 3 columns; all should be revealed.
    expect(container.querySelectorAll('.kanban-row[data-row-index="0"] .card[data-hidden-revealed]').length).toBe(7);
    // Row 1 untouched.
    expect(container.querySelectorAll('.kanban-row[data-row-index="1"] .card[data-hidden-revealed]').length).toBe(0);
  });

  it('revealStackContent only touches cards inside the matching .kanban-column-stack within the row', () => {
    ColumnContextMenu.revealStackContent(0, 1);
    // Row 0, stack 1 has 2 cards (col-index=2: f, g) — both revealed.
    expect(container.querySelectorAll('.kanban-row[data-row-index="0"] .kanban-column-stack[data-stack-index="1"] .card[data-hidden-revealed]').length).toBe(2);
    // Row 0 stack 0 untouched.
    expect(container.querySelectorAll('.kanban-row[data-row-index="0"] .kanban-column-stack[data-stack-index="0"] .card[data-hidden-revealed]').length).toBe(0);
    // Row 1 untouched.
    expect(container.querySelectorAll('.kanban-row[data-row-index="1"] .card[data-hidden-revealed]').length).toBe(0);
  });

  it('revealRowContent is a no-op when the row index is out of range', () => {
    expect(() => ColumnContextMenu.revealRowContent(99)).not.toThrow();
    expect(container.querySelectorAll('.card[data-hidden-revealed]').length).toBe(0);
  });

  it('revealStackContent is a no-op when the stack index is out of range', () => {
    expect(() => ColumnContextMenu.revealStackContent(0, 99)).not.toThrow();
    expect(container.querySelectorAll('.card[data-hidden-revealed]').length).toBe(0);
  });
});
