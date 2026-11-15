// Semantic versioning of the published site: which version the next deploy gets, decided from the commits since the
// last version tag (vX.Y.Z). Pure: git and GitHub come in as arguments (next.mjs wires the real ones).

// Folders the Pages build publishes (keep in sync with the "Build site" step of .github/workflows/pages.yml):
// a commit that touches none of them does not change the site, so it does not bump the version.
export const SITE_PATHS = ['home', 'web', 'viewpoint', 'prototipo', 'rolegame', 'lander', 'shared', 'planner/src'];

// Issue labels that mean "something new" (minor). Any other change is a fix (patch).
export const MINOR_LABELS = ['enhancement'];

const LEVELS = ['patch', 'minor', 'major'];

export function parseVersion(text) {
  const m = String(text ?? '').trim().match(/^v?(\d+)\.(\d+)\.(\d+)$/);
  return m ? m.slice(1).map(Number) : null;
}

export const formatVersion = v => v.join('.');

export function compareVersions(a, b) {
  for (let i = 0; i < 3; i++) if (a[i] !== b[i]) return a[i] - b[i];
  return 0;
}

// Highest valid version among tag names; null if there is none.
export function latestVersion(tags) {
  return tags.map(parseVersion).filter(Boolean).sort(compareVersions).at(-1) ?? null;
}

export function bump([major, minor, patch], level) {
  if (level === 'major') return [major + 1, 0, 0];
  if (level === 'minor') return [major, minor + 1, 0];
  return [major, minor, patch + 1];
}

export const maxLevel = (a, b) => (LEVELS.indexOf(a) >= LEVELS.indexOf(b) ? a : b);

// Issue numbers a commit message refers to (#12).
export function issueRefs(message) {
  return [...new Set([...String(message).matchAll(/(?<![\w&])#(\d+)\b/g)].map(m => Number(m[1])))];
}

// What the message alone says: an explicit mark in the subject ([major], [minor]), a BREAKING CHANGE line or a
// conventional prefix (feat: → minor, feat!: → major). The marks only count in the subject: a body that explains them
// must not bump. null when it says nothing, and then the labels of its issues decide.
export function levelFromMessage(message) {
  const text = String(message);
  const subject = text.split('\n', 1)[0];
  if (/\[major\]/i.test(subject) || /^BREAKING[ -]CHANGE\b/m.test(text) || /^\w+(\([^)]*\))?!:/.test(subject)) return 'major';
  if (/\[minor\]/i.test(subject) || /^feat(\([^)]*\))?:/i.test(subject)) return 'minor';
  return null;
}

// Level of a set of commits. `labelsOf(issue)` resolves to the label names of an issue ([] if unknown).
export async function levelOf(messages, labelsOf) {
  let level = 'patch';
  const pending = new Set();
  for (const message of messages) {
    const own = levelFromMessage(message);
    if (own) level = maxLevel(level, own);
    else issueRefs(message).forEach(n => pending.add(n));
  }
  // Labels can only raise the level to minor: stop asking as soon as it is reached.
  for (const issue of pending) {
    if (level !== 'patch') break;
    if ((await labelsOf(issue)).some(label => MINOR_LABELS.includes(label))) level = 'minor';
  }
  return level;
}

/**
 * Version of the deploy of HEAD.
 * @param {object} state
 * @param {string[]} state.tags tags reachable from HEAD
 * @param {string[]} state.headTags tags that point at HEAD
 * @param {string} state.headSubject subject of the HEAD commit
 * @param {(sinceTag: string|null) => string[]} state.siteMessages messages of the commits after that tag that touch SITE_PATHS
 * @param {(issue: number) => Promise<string[]>} state.labelsOf
 * @returns {Promise<{version: string, previous: string|null, level: string|null, create: boolean}>} `create`: the tag is new and has to be pushed
 */
export async function resolveVersion({ tags, headTags, headSubject, siteMessages, labelsOf }) {
  const latest = latestVersion(tags);
  const previous = latest && formatVersion(latest);
  const keep = version => ({ version, previous, level: null, create: false });

  // HEAD is already a version (a re-run of the deploy, or a tag put by hand).
  const atHead = latestVersion(headTags);
  if (atHead) return keep(formatVersion(atHead));
  // A release commit (release/release.sh) names its own version and pushes its own tag.
  const released = parseVersion(headSubject.match(/^release: (v\S+)$/)?.[1]);
  if (released && (!latest || compareVersions(released, latest) > 0)) return keep(formatVersion(released));

  if (!latest) return { version: '0.1.0', previous: null, level: 'minor', create: true };
  const messages = siteMessages(`v${previous}`);
  if (!messages.length) return keep(previous);
  const level = await levelOf(messages, labelsOf);
  return { version: formatVersion(bump(latest, level)), previous, level, create: true };
}
