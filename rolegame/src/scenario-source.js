// Which scenario the screen opens and what it says about its relief (J9.2). Pure: no DOM, no fetch.

// The id of ?scenario=<id> when it is in the list of rolegame/data/scenarios.json; the default otherwise.
export function scenarioId(list, search = '') {
  const asked = new URLSearchParams(search).get('scenario');
  return asked && list.scenarios.includes(asked) ? asked : list.default;
}

// Folder of a scenario, relative to rolegame/.
export const scenarioPath = (id) => `data/${id}/`;

// Name of the scenario in a language: LOLA scenarios carry { es, en }, the procedural one a plain string.
export const scenarioName = (scenario, lang = 'es') =>
  (typeof scenario.name === 'string' ? scenario.name : scenario.name?.[lang] ?? scenario.name?.es ?? scenario.id);

// True when the relief comes from the LOLA DEM; a scenario.json without source is the procedural one.
export const isRealRelief = (scenario) => scenario.source?.type === 'lola';

// Text of the .badge label: «Relieve LOLA · <región>» on LOLA, «Relieve inventado» otherwise.
export const badgeText = (scenario, texts, lang = 'es') => (isRealRelief(scenario) ? texts.badgeReal(scenarioName(scenario, lang)) : texts.badge);

// Tutorial steps that tell the same as the scenario: where the crew landed (from its site) and what the badge means.
export function tutorialStepsFor(scenario, texts, lang = 'es') {
  const place = texts.landingPlace[scenario.siteId] ?? texts.landingPlaceDefault;
  return texts.tutorialSteps.map((step, i) => {
    if (i === 0) return { ...step, text: texts.tutorialLanded(place) };
    if (step.target === '.badge') {
      return isRealRelief(scenario)
        ? { ...step, title: texts.tutorialBadgeRealTitle, text: texts.tutorialBadgeReal(scenarioName(scenario, lang)) }
        : step;
    }
    return step;
  });
}

// Levels a scenario plays (#313): levels.json with the fields its scenario.json overrides in `levels`, the same
// merge the pipeline's solver used. Scenarios without `levels` play the common ones (same objects).
export function levelsFor(levels, scenario) {
  const over = scenario?.levels;
  if (!over) return levels;
  return Object.fromEntries(Object.entries(levels).map(([id, level]) => [id, over[id] ? { ...level, ...over[id] } : level]));
}
