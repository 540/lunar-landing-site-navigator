// Keys and icons of the mission panel buttons (J13.4, #312). The keys shown are the map shortcuts of J10.3
// (SHORTCUTS of cell-report.js), so a button never shows a key that does not work. Pure: no DOM here.
import { SHORTCUTS, keyAction } from './cell-report.js';

// Icon of each button (the mock-up's IC): antenna for transmitting, Sun and Earth for the waits that need them.
export const BUTTON_ICONS = { transmit: 'antenna', 'wait-sun': 'sun', 'wait-earth': 'earth' };

// Key of a button as written on it («T», «2»), or null if it has no shortcut.
export function buttonKey(id) {
  const key = SHORTCUTS[id];
  if (!key) return null;
  return key.replace('Shift+', '⇧');
}

// The key event that a shortcut stands for ({ key, shiftKey }), to check it really triggers the button.
export function keyEventOf(id) {
  const key = SHORTCUTS[id];
  if (!key) return null;
  const shift = key.startsWith('Shift+');
  const k = shift ? key.slice(6) : key;
  return { key: shift ? k.toUpperCase() : k.toLowerCase(), shiftKey: shift };
}

// True when the shortcut of `id` triggers that same action.
export const keyMatches = (id) => keyEventOf(id) !== null && keyAction(keyEventOf(id)) === id;

// SVG paths of the icons (24 × 24, stroked), from the mock-up.
export const ICON_PATHS = {
  antenna: ['M5 19l5-9M10 10l4 9M7.5 15h5', 'M14.5 6.5a4 4 0 0 1 3 3M14 3.5a7 7 0 0 1 6.5 6.5'],
  sun: ['M12 8a4 4 0 1 0 0 8a4 4 0 1 0 0-8z', 'M12 2.5v2.5M12 19v2.5M2.5 12H5M19 12h2.5M5.3 5.3l1.8 1.8M16.9 16.9l1.8 1.8M5.3 18.7l1.8-1.8M16.9 7.1l1.8-1.8'],
  earth: ['M12 3.5a8.5 8.5 0 1 0 0 17a8.5 8.5 0 1 0 0-17z', 'M4 9.5c3 .5 4.5 2 4 4.5s1.5 3 3 5M13 3.8c-.5 2 .5 3.5 2.5 4s3.5 2 3 4'],
  warn: ['M12 3.5l9.5 16.5h-19z', 'M12 10v4.5M12 17.2v.3'],
};
