// Texts of the tour buttons. Without `labels`, those of the page language (<html lang>, set by shared/i18n/page.js):
// Spanish by default, English with lang="en". A screen can still pass its own. `count(i, total)` is the step counter.
export const DEFAULT_LABELS = {
  next: 'Siguiente',
  prev: 'Anterior',
  skip: 'Saltar el tutorial',
  done: 'Entendido',
  more: 'Saber más',
  never: 'No mostrar más tutoriales',
  single: 'Tutorial',
  count: (i, total) => `Tutorial · paso ${i} de ${total}`,
};
export const EN_LABELS = {
  next: 'Next',
  prev: 'Back',
  skip: 'Skip the tutorial',
  done: 'Got it',
  more: 'Learn more',
  never: 'Don’t show tutorials again',
  single: 'Tutorial',
  count: (i, total) => `Tutorial · step ${i} of ${total}`,
};
const pageLang = () => globalThis.document?.documentElement?.lang ?? 'es';
export const tourLabels = (labels = null, lang = pageLang()) => ({ ...(lang === 'en' ? EN_LABELS : DEFAULT_LABELS), ...(labels || {}) });
