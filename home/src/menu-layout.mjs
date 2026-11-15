// Where the menu puts the Mission 04 lander and the "Explorar la Luna" rocket on phones, so that their labels stay in
// the free sky between the header (title, light and tutorial buttons) and the dock. Pure: index.html passes the pixels.

// Gap between a label and the header or the dock, in px
export const MENU_GAP = 8;

// NDC height of the lander on phones: `top` (the usual one) unless that would put its label under the header.
// headerBottom: bottom of .brand, in px from the top; reach: px from the lander's anchor (the point placed on the
// screen) up to the top of the lander or of its label, whichever is higher.
export function landerNdcY({ top, headerBottom, reach, height }) {
  const minAnchor = headerBottom + MENU_GAP + reach;
  return Math.min(top, 1 - 2 * minAnchor / height);
}

// NDC x of the lander on phones: `preferred` unless its label, on its left (labelWidth px, gap px from the lander's
// centre), would not fit before the left edge (MENU_GAP).
export function landerNdcX({ preferred, labelWidth, gap, width }) {
  return Math.max(preferred, -1 + 2 * (MENU_GAP + labelWidth + gap) / width);
}

// px the rocket goes up so that its label (bottom edge at labelBottom) ends MENU_GAP above the dock (top at dockTop)
export function liftAboveDock({ labelBottom, dockTop }) {
  return Math.max(0, labelBottom - (dockTop - MENU_GAP));
}

// px between the bottom of the header and the top of the mission list (the column's gap plus the list's margin)
export const MCARDS_OFFSET = 16;

// Whether the whole mission list (listHeight px, natural) fits between the header (bottom at headerBottom) and the
// dock (top at dockTop) with MENU_GAP to spare; the list never shows cropped or over either of them.
export function mcardsFit({ headerBottom, listHeight, dockTop }) {
  return headerBottom + MCARDS_OFFSET + listHeight <= dockTop - MENU_GAP;
}

// Whether the left list of "Explorar la Luna" overflows, so it scrolls; on the horizontal mobile row it does not
export function chipsScrolls({ scrollHeight, clientHeight }) {
  return scrollHeight > clientHeight;
}

// Which edges of the left list fade: `up` when cards hide above, `down` when they hide below. 1 px of tolerance
// for the sub-pixel remainders of scrollTop on zoomed or scaled screens.
export function chipsFade({ scrollTop, scrollHeight, clientHeight }) {
  return {
    up: scrollTop > 1,
    down: scrollHeight - clientHeight - scrollTop > 1,
  };
}

// Fallback px from the rocket's centre (where the lock reticle is centred) down to the top of the reticle's data chip:
// half of the reticle (72 px) plus the chip's offset below it (6 px). It copies `.lock` and `.lock span` in index.html,
// so index.html measures the real offset from the DOM and passes it as `chipOffset`; this is only the default.
export const LOCK_CHIP_OFFSET = 36 + 6;

// Top (px from the top of the screen) of the "Explorar la Luna" label, below the reticle's chip with MENU_GAP to
// spare. rocketY: centre of the rocket at rest (not the hovered one, so the label never moves with the pointer);
// chipHeight: real height of the chip; chipOffset: measured px from the rocket's centre to the chip's top; anchorTop: where the label would go without the chip (it never goes above it)
// clearance: px left under the chip (MENU_GAP by default; more when the line to the rocket has to be seen there)
export function labelBelowChip({ rocketY, chipHeight, chipOffset = LOCK_CHIP_OFFSET, anchorTop, clearance = MENU_GAP }) {
  return Math.max(anchorTop, rocketY + chipOffset + chipHeight + clearance);
}

// Margins of the line that joins the rocket with its label, the same the missions leave around their tick:
// ROCKET_LINE_MARGIN px at each end (the 8 px gap of `.zl`: between the line and the label's box, and between the
// rocket and the line) and ROCKET_LINE_CHIP px of air around the chip.
export const ROCKET_LINE_MARGIN = 8;
export const ROCKET_LINE_CHIP = 4;
// px of line that must stay in sight between the chip and the label, so the join still reads while hovering
export const ROCKET_LINE_MIN = 10;
// px from the bottom of the chip to the top of the label's box that leave room for that piece of line and its margins
export const ROCKET_LINE_CLEARANCE = ROCKET_LINE_CHIP + ROCKET_LINE_MIN + ROCKET_LINE_MARGIN;

// The line that joins the rocket with its label, like the tick of the missions but upright. It starts
// ROCKET_LINE_MARGIN under the rocket (rocketBottom: the tip of its flame, which is what is seen lowest) and ends
// ROCKET_LINE_MARGIN above the label's box (boxTop). `length` is its height in px (0 when there is no room). While
// the reticle shows its chip (chipShown) the line passes behind it: it is not drawn from `gapFrom` to `gapTo` (px
// from the start of the line). Without the chip, or when it does not cross the line, both equal `length`: no gap.
export function rocketLine({ rocketBottom, boxTop, chipTop, chipHeight, chipShown }) {
  const start = rocketBottom + ROCKET_LINE_MARGIN, length = Math.max(0, Math.round(boxTop - ROCKET_LINE_MARGIN - start));
  const clamp = v => Math.min(length, Math.max(0, Math.round(v)));
  const from = clamp(chipTop - ROCKET_LINE_CHIP - start), to = clamp(chipTop + chipHeight + ROCKET_LINE_CHIP - start);
  if (!chipShown || to <= from) return { length, gapFrom: length, gapTo: length };
  return { length, gapFrom: from, gapTo: to };
}
