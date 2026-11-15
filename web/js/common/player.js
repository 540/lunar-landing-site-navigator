// The mission player: one playback (state.playing) for every view, so every play button shows the same state.
import { t } from './i18n.js';

export const PLAY_LABEL = { play: t('common.player.play'), pause: t('common.player.pause') };

/** Paints each play button with the state of the playback: ❚❚ «Pausar» while it plays, ▶ «Reproducir» when stopped. */
export function paintPlayButtons(buttons, playing) {
  for (const b of buttons) {
    if (!b) continue;
    b.textContent = playing ? '❚❚' : '▶';
    b.setAttribute('aria-label', playing ? PLAY_LABEL.pause : PLAY_LABEL.play);
  }
}
