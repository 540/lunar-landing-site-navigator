// «Ajustes» in the header (J13.3, #311): map quality, light mode and reduced motion in one menu, as in the mock-up.
// Pure: what the quality choice asks the map for and how the focus moves inside the open menu. No DOM here.

// The game's own choice of map quality. The home page keeps its calibration in shared/render/quality.js (#143);
// this key only says what the player picked in «Ajustes», and ?q= in the address still wins.
export const QUALITY_KEY = 'llsn.gameQuality';
// The two choices of the mock-up: high (penumbra) and low (hard shadow).
export const QUALITY_CHOICES = ['alto', 'bajo'];

// Address parameters the map backdrop reads: ?q= if present, else the choice saved in «Ajustes», else none
// (then the home page calibration decides, as before).
export function qualityParams(search, saved) {
  const params = new URLSearchParams(search);
  if (!params.has('q') && QUALITY_CHOICES.includes(saved)) params.set('q', saved);
  return params;
}

// Which of the two buttons is pressed for the level the map is using ('medio' also has penumbra).
export const pressedQuality = (level) => (level === 'bajo' ? 'bajo' : 'alto');

// Focus trap of the open menu: index of the next control with Tab (or Shift+Tab), wrapping around.
export function trapIndex(index, count, back = false) {
  if (count <= 0) return -1;
  if (index < 0) return back ? count - 1 : 0;
  return (index + (back ? count - 1 : 1)) % count;
}
