// Old site ids that links (?site=…) and the mission history may still carry → the id of the site now.
// connecting-ridge took the backend id and coordinates; mouton (approximate) gave way to the verified IM-2 target.
export const SITE_ALIASES = { 'connecting-ridge': 'shackleton-rim', mouton: 'im2-objetivo' };

export const canonicalSiteId = id => (typeof id === 'string' && Object.hasOwn(SITE_ALIASES, id) ? SITE_ALIASES[id] : id);
