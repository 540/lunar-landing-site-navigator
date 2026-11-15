// Language of the screens (J10.1, #242; E8, #283): which one to start in, where the choice is kept and how texts
// are looked up. Pure: no DOM, no window. The caller reads the address, localStorage and navigator.languages and
// passes them in; shared/i18n/page.js does that in the browser.

export const LANGS = ['es', 'en'];
export const DEFAULT_LANG = 'es';
export const STORAGE_KEY = 'llsn.lang';
export const QUERY_KEY = 'lang';
// Locale for Intl (numbers and dates): decimal comma in Spanish, decimal point in English.
export const LOCALES = { es: 'es-ES', en: 'en-GB' };

const valid = (v) => (LANGS.includes(v) ? v : null);

/** The language asked for in the address (`?lang=en`), or null. */
export function langFromSearch(search) {
  try { return valid(new URLSearchParams(search ?? '').get(QUERY_KEY)); } catch { return null; }
}

// The address first, then the saved choice, then the browser: 'es' if its first language is Spanish, 'en' if it is
// any other one. 'es' when there is nothing to go on.
export function pickLang({ query = null, saved = null, languages = [] } = {}) {
  if (valid(query)) return query;
  if (valid(saved)) return saved;
  const first = languages?.[0];
  if (!first) return DEFAULT_LANG;
  return String(first).toLowerCase().startsWith('es') ? 'es' : 'en';
}

/**
 * t(key, ...args) over a { es, en } pair of dictionaries. A key missing in the language in use falls back to Spanish,
 * and a key missing in both gives the key itself (visible, but nothing breaks). A function value is called with the
 * arguments; a string value fills its {name} placeholders from an object argument.
 */
export function translator(dicts, lang) {
  const own = dicts?.[lang] ?? {};
  const base = dicts?.[DEFAULT_LANG] ?? {};
  return function t(key, ...args) {
    const v = key in own ? own[key] : base[key];
    if (v === undefined) return key;
    if (typeof v === 'function') return v(...args);
    const vars = args[0];
    if (typeof v === 'string' && vars && typeof vars === 'object') {
      return v.replace(/\{(\w+)\}/g, (m, name) => (name in vars ? String(vars[name]) : m));
    }
    return v;
  };
}

/** Keys of `es` that `en` lacks: what is still untranslated. */
export const missingKeys = (es, en) => Object.keys(es ?? {}).filter((k) => !(k in (en ?? {})));

/** Keys of `en` that `es` lacks: leftovers of a renamed or removed text. */
export const extraKeys = (es, en) => missingKeys(en, es);

// The same href with ?lang=… set, keeping its other parameters and its hash. Only relative links (another screen of
// the site, or this one): absolute, protocol, hash-only and empty hrefs come back untouched.
export function withLang(href, lang) {
  if (!href || !valid(lang)) return href;
  if (/^([a-z][a-z0-9+.-]*:|\/\/|#)/i.test(href)) return href;
  const hashAt = href.indexOf('#');
  const hash = hashAt >= 0 ? href.slice(hashAt) : '';
  const rest = hashAt >= 0 ? href.slice(0, hashAt) : href;
  const qAt = rest.indexOf('?');
  const path = qAt >= 0 ? rest.slice(0, qAt) : rest;
  const params = new URLSearchParams(qAt >= 0 ? rest.slice(qAt + 1) : '');
  params.set(QUERY_KEY, lang);
  return `${path}?${params.toString()}${hash}`;
}
