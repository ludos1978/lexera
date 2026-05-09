// Drop-zone indicator active-state visibility contract.
//
// Regression fence for 2026-05-08 user report: "the drag highlight is
// bad and unusable". Root cause: the body-level "Drop indicators /
// drag feedback — dashed hairlines" override at app.css:~9874 strips
// the indicator's solid `var(--accent)` background to a 6% accent
// fill. Combined with the .active state's `opacity: 0.6`, the
// effective visibility was ~3.6% — on a 4px-wide bar, nearly
// invisible.
//
// Fix: a follow-up `body .drop-zone-indicator.active` rule restores
// solid accent + full opacity for the active state so the landing
// position is unmistakable. Inactive indicators stay faint (the
// dashed-hairline design for "candidate positions" is preserved).
//
// This test pins:
//   1. The dashed-hairline body override still exists (design intent
//      for inactive indicators / generic .drop-zone / .drag-over /
//      .drop-target classes).
//   2. The active override exists AND restores solid background,
//      solid border, and full opacity.

import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const __dirname = dirname(fileURLToPath(import.meta.url));
const appCss = readFileSync(resolve(__dirname, '..', 'src', 'app.css'), 'utf8');

describe('drop-zone indicator active-state visibility', () => {
  it('keeps the dashed-hairline body override as the inactive design', () => {
    // Selector list MUST stay grouped — the four classes share the
    // same hairline language, and splitting them would invite drift.
    expect(appCss).toMatch(
      /body\s+\.drop-zone-indicator,\s*\n\s*body\s+\.drop-zone,\s*\n\s*body\s+\.drag-over,\s*\n\s*body\s+\.drop-target\s*\{/
    );
    // Body-level dashed border + 6% accent fill is the inactive look.
    expect(appCss).toMatch(
      /body\s+\.drop-zone-indicator[\s\S]{0,160}border:\s*1px\s+dashed\s+var\(--accent\)/
    );
    expect(appCss).toMatch(
      /body\s+\.drop-zone-indicator[\s\S]{0,200}background:\s*color-mix\(in srgb, var\(--accent\)\s*6%/
    );
  });

  it('restores solid accent + full opacity for the active drop-zone indicator', () => {
    // The fix selector — `.active` makes it survive the body
    // override's specificity and bring the bar back to a clearly
    // visible drop-target marker.
    const activeBlock = appCss.match(
      /body\s+\.drop-zone-indicator\.active\s*\{([\s\S]*?)\}/
    );
    expect(activeBlock, 'body .drop-zone-indicator.active rule must exist').not.toBeNull();
    const body = activeBlock[1];
    expect(body).toMatch(/background:\s*var\(--accent\)\s*;/);
    expect(body).toMatch(/border-color:\s*var\(--accent\)\s*;/);
    expect(body).toMatch(/border-style:\s*solid\s*;/);
    expect(body).toMatch(/opacity:\s*1\s*;/);
  });

  it('places the active override AFTER the dashed-hairline group (cascade order)', () => {
    const groupIdx = appCss.search(
      /body\s+\.drop-zone-indicator,\s*\n\s*body\s+\.drop-zone/
    );
    const activeIdx = appCss.search(/body\s+\.drop-zone-indicator\.active/);
    expect(groupIdx).toBeGreaterThan(-1);
    expect(activeIdx).toBeGreaterThan(-1);
    // Cascade: the more-specific .active rule must be defined LATER
    // in the file so it wins on equal specificity.
    expect(activeIdx).toBeGreaterThan(groupIdx);
  });
});
