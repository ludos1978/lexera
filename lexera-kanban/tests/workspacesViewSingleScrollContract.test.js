import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

/**
 * Pin the single-scrollbar contract for the workspaces sub-app view.
 *
 * The global `.board-list` rule in app.css gives `flex: 1 1 auto` +
 * `overflow-y: auto` to the board tree — that's the right behavior
 * inside the main board sidebar (fixed-height parent, tree scrolls
 * within it). Inside the workspaces sub-app the outer `<main class="body">`
 * is the actual scroll container, and any scroll on the inner tree
 * produces a "scrollbar within a scrollbar" (one for the page, one for
 * the tree). This contract test guarantees the workspaces view keeps
 * neutralizing the inner overflow.
 */

const __dirname = dirname(fileURLToPath(import.meta.url));
const workspacesCss = readFileSync(
  resolve(__dirname, '..', 'src', 'views', 'workspaces', 'workspaces.css'),
  'utf8'
);

describe('workspaces sub-app — single-scrollbar layout contract', () => {
  it('keeps the outer .body as the only auto-overflow scroll container', () => {
    // The outer `<main class="body">` is the page scroller.
    expect(workspacesCss).toMatch(/\.body\s*\{[^}]*overflow:\s*auto;/);
  });

  it('neutralizes the global .board-list inner overflow inside the body', () => {
    // The selector `.body > section > .board-list` (or stronger) must
    // override the app.css rule that gives `.board-list` its own scroll.
    // We accept any rule that scopes overflow on .board-list under .body.
    expect(workspacesCss).toMatch(/\.body[^{]*\.board-list\s*\{[\s\S]*?overflow:\s*visible/);
  });

  it('disables the .board-list flex-grow inside the body so the tree sizes to its content', () => {
    // Without flex: 0 0 auto, the tree would still claim 100% of the
    // remaining vertical space and only its own contents would scroll.
    expect(workspacesCss).toMatch(/\.body[^{]*\.board-list\s*\{[\s\S]*?flex:\s*0\s+0\s+auto/);
  });

  it('zeros the .board-list min-height inside the body so a small tree does not push siblings off-screen', () => {
    // The global rule sets a min-height tuned for the sidebar; in the
    // workspaces view it would force unwanted vertical space below
    // the tree even when the tree itself is short.
    expect(workspacesCss).toMatch(/\.body[^{]*\.board-list\s*\{[\s\S]*?min-height:\s*0/);
  });
});
