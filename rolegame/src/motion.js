// Reduced motion (J10.2, #243): whether the game animates. Pure: the caller reads prefers-reduced-motion and the
// saved choice and passes them in. Every animation of the game (driving, waiting, the pad pulse, and later the
// GPU shadows and the 3D Moon) asks this, not the system query alone.

export const MOTION_KEY = 'llsn.motion';
export const MOTION_VALUES = ['reduce', 'full'];

// 'reduce' saved → true; 'full' saved → false; nothing (or anything else) saved → what the system asks for.
export function reduceMotion({ systemPrefers = false, saved = null } = {}) {
  if (saved === 'reduce') return true;
  if (saved === 'full') return false;
  return Boolean(systemPrefers);
}

// What the switch saves when pressed: the opposite of what is in use now.
export const toggledMotion = (reducedNow) => (reducedNow ? 'full' : 'reduce');
