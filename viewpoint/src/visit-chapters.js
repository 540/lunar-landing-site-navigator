// The chapters of the guided visit (E6.1), as data: adding one is adding an entry, without touching the engine (core/visit.js).
// The texts (title, question, options, reveal) are in src/texts.js under `visit.chapters[id]`; the options here carry the same ids.
//   id       key of the chapter in the texts
//   region   region where it can be told (a folder of viewpoint/data/)
//   start    start date (UTC) of the 60 days it shows; it has to be inside series-2027.json
//   view     'drone' | 'foot': the view it needs (E6.2: on foot the visit goes down by the flag and looks where the action says)
//   measure  what it measures, the value that is compared with `from`: 'sun-difference' (default: change in the share of the period with Sun, 0..1),
//            'shadow-km' (length of the shadow of a 1 km relief at the highest Sun of the period) or 'earth-time' (share of the period with Earth, 0..1)
//   minDifference  only for 'sun-difference': the least change (0..1) that the chapter can grade: if no nearby point reaches it, the chapter says so and does not grade the bet
//   options  the answers in order; `from` is the least measured value for the option to be the right one: the right option is the one with the greatest `from` the measure reaches.
//            No options: a closing chapter without bet or verdict (the button «Comprobar» reveals)
//   action   what the scene does on revealing; `move-flag-to-contrast`: the flag travels to the nearby point where the light differs most;
//            `foot-look-away-from-sun`: on foot, the time at the chosen instant, looking away from the Sun (to see long shadows);
//            `foot-look-at-earth`: on foot, looking at the Earth with the time running until the relief hides it;
//            `compare-with-best`: the visitor moves the flag and the reveal compares its score with the best nearby point
export const CHAPTERS = Object.freeze([
  {
    id: 'move-the-flag',
    region: 'shackleton-rim',
    start: '2027-01-15',
    view: 'drone',
    minDifference: 0.05,
    options: [
      { id: 'almost-nothing', from: 0.05 },
      { id: 'a-little', from: 0.1 },
      { id: 'a-lot', from: 0.3 },
    ],
    action: { type: 'move-flag-to-contrast', radiusKm: 0.5 },
  },
  {
    id: 'long-shadows',
    region: 'shackleton-rim',
    start: '2027-01-15',
    view: 'foot',
    measure: 'shadow-km',
    options: [
      { id: 'under-a-km', from: 0 },
      { id: 'a-few-km', from: 1 },
      { id: 'tens-of-km', from: 20 },
    ],
    action: { type: 'foot-look-away-from-sun' },
  },
  {
    id: 'call-home',
    region: 'shackleton-rim',
    start: '2027-01-15',
    view: 'foot',
    measure: 'earth-time',
    options: [
      { id: 'less-than-half', from: 0 },
      { id: 'more-than-half', from: 0.5 },
      { id: 'always', from: 0.999 },
    ],
    action: { type: 'foot-look-at-earth' },
  },
  {
    id: 'you-decide',
    region: 'shackleton-rim',
    start: '2027-01-15',
    view: 'drone',
    options: [],
    action: { type: 'compare-with-best' },
  },
]);

/** The chapters that can be told in a region. */
export const chaptersFor = (regionId, chapters = CHAPTERS) => chapters.filter(c => c.region === regionId);
