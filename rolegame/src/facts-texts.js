// Texts with the figures of the scenario (J9.4): the expert introduction and the lessons of the end read `facts`
// of scenario.json (computed by the pipeline), never a figure written by hand. Pure: no DOM here.

// Dictionary for the introduction and the end of a game: the expert level takes the expert introduction and trial
// questions and reveals with the scenario's figures; every level takes the Sun lesson with the scenario's figure.
// Without `facts` (an old scenario) the texts fall back to a form without figures.
export function withFacts(texts, { expert = false, facts = null, level } = {}) {
  const out = { ...texts, lessons: texts.lessons.map((l, k) => (k === 0 ? { ...l, text: texts.lessonSun(facts) } : l)) };
  if (!expert) return out;
  const extra = texts.trialsExpert(facts, level);
  out.introText = (_km, trials) => texts.introExpert(facts, trials, texts.goalPacketsDetail(level?.txMinKm ?? 1));
  out.trials = Object.fromEntries(Object.entries(texts.trials).map(([k, t]) => [k, { ...t, ...extra[k] }]));
  return out;
}
