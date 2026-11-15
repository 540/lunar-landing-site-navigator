// The guided visit (E6.1): the state of the visit and its transitions. Pure: no DOM, no three.js, no fetch. Every function
// takes a state and returns a new one; the screen (visit-ui.js) draws it and moves the scene to what `flagTarget` says.
// A chapter is plain data (src/visit-chapters.js): the engine only needs how many there are and how many options each has.

export const LEVELS = Object.freeze(['beginner', 'intermediate', 'expert']);
export const DEFAULT_LEVEL = 'intermediate';
export const PHASES = Object.freeze({ question: 'question', bet: 'bet', revealed: 'revealed' });

/** `level` if it is one of LEVELS, otherwise the default (what localStorage may hold is not trusted). */
export const parseLevel = level => (LEVELS.includes(level) ? level : DEFAULT_LEVEL);

/**
 * Opens the visit at the first chapter, in the phase of the question.
 * @param {object[]} chapters the chapters in order (at least one), each with `options`
 * @param {{level?:string, origin:{x:number, z:number}}} options `origin`: where the chapters start (the site of the region); the flag is there at every chapter's question
 */
export function startVisit(chapters, { level = DEFAULT_LEVEL, origin }) {
  if (!Array.isArray(chapters) || !chapters.length) throw new RangeError('The visit needs at least one chapter');
  return { active: true, chapters, index: 0, phase: PHASES.question, choice: null, level: parseLevel(level), origin: { x: origin.x, z: origin.z } };
}

export const chapterOf = state => state.chapters[state.index];

/** The visitor bets on option `choice` (also valid to change the bet before revealing). Anything else leaves the state as it is. */
export function bet(state, choice) {
  if (!state.active || state.phase === PHASES.revealed) return state;
  if (!Number.isInteger(choice) || choice < 0 || choice >= chapterOf(state).options.length) return state;
  return { ...state, phase: PHASES.bet, choice };
}

/**
 * Shows the answer. From «bet» it keeps the bet; from «question» it is «Enséñamelo sin apostar» (no choice).
 * `available: false` (no grid, or not loaded yet) forbids it: the chapter says so and nothing is revealed.
 */
export function reveal(state, { available = true } = {}) {
  if (!state.active || !available || state.phase === PHASES.revealed) return state;
  return { ...state, phase: PHASES.revealed };
}

const goTo = (state, index) => (!state.active || index < 0 || index >= state.chapters.length || index === state.index
  ? state
  : { ...state, index, phase: PHASES.question, choice: null });

export const previous = state => goTo(state, state.index - 1);
export const next = state => goTo(state, state.index + 1);
export const chapterAt = (state, index) => goTo(state, index);
export const hasPrevious = state => state.index > 0;
export const hasNext = state => state.index < state.chapters.length - 1;

/** The level changes the texts of the question and the reveal, never the phase or the bet. */
export const setLevel = (state, level) => (LEVELS.includes(level) ? { ...state, level } : state);

/** Leaves the visit. The screen puts the flag back where the visitor had it before opening (not the origin of the chapters). */
export const exit = state => ({ ...state, active: false });

/** What a chapter measures (the value that `rightOption` compares with `from`): 'sun-difference' unless the chapter says another. */
export const measureOf = chapter => chapter.measure ?? 'sun-difference';
/** A chapter with options is graded; one without them (the closing «Tú decides») has no bet. */
export const isGraded = chapter => chapter.options.length > 0;
/** The visitor can move the flag in this phase: only in a chapter that asks for it (action `compare-with-best`), before the reveal. */
export const canMoveFlag = state => state.active && state.phase !== PHASES.revealed && chapterOf(state).action?.type === 'compare-with-best';

/**
 * The index of the right option for a measured value `difference` (what `measureOf(chapter)` says: the change of light, the km of a
 * shadow, the share of time with Earth; compared in absolute value): the option with the greatest `from` the value reaches.
 * -1 if it reaches none of them (below the first threshold) or the chapter has no options.
 */
export function rightOption(chapter, difference) {
  if (!chapter.options.length) return -1;
  const d = Math.abs(difference);
  let right = -1;
  chapter.options.forEach((o, i) => { if (d + 1e-12 >= o.from && (right < 0 || o.from > chapter.options[right].from)) right = i; });
  return right;
}

/**
 * What the bet turned out to be once revealed: 'correct' or 'wrong' (against the change of light measured between the site and the
 * point, `difference`), or 'none' (revealed without betting, or the chapter could not grade it).
 */
export function outcome(state, difference) {
  if (state.phase !== PHASES.revealed || !isGraded(chapterOf(state)) || state.choice === null || !Number.isFinite(difference)) return 'none';
  const right = rightOption(chapterOf(state), difference);
  if (right < 0) return 'none';
  return right === state.choice ? 'correct' : 'wrong';
}

/**
 * Where the flag has to be: at the destination of the chapter only while it is revealed; in any other phase (another
 * chapter, back to the question, exited) at the origin. `destination` is what the action of the chapter found (null if it found none).
 */
export function flagTarget(state, destination) {
  return state.active && state.phase === PHASES.revealed && destination ? { x: destination.x, z: destination.z } : { x: state.origin.x, z: state.origin.z };
}
