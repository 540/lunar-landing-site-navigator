// Language in the browser (E8, #283): reads the address, localStorage and navigator, keeps the choice, fills the
// static texts of a page, mounts the ES/EN switch and carries the language on links to the other screens.
// The rules themselves are pure and tested in lang.js.
import { LANGS, STORAGE_KEY, QUERY_KEY, langFromSearch, pickLang, withLang } from './lang.js';

const read = () => { try { return localStorage.getItem(STORAGE_KEY); } catch { return null; } };
// In private mode the choice is not saved: the ?lang= that links carry keeps it from screen to screen.
export const storeLang = (lang) => { try { localStorage.setItem(STORAGE_KEY, lang); } catch { /* not saved */ } };

/** The language of this page; an explicit ?lang= is also saved. Sets <html lang>. */
export function initLang() {
  const query = langFromSearch(location.search);
  if (query) storeLang(query);
  const lang = pickLang({ query, saved: read(), languages: navigator.languages?.length ? navigator.languages : [navigator.language] });
  document.documentElement.lang = lang;
  return lang;
}

// Static texts: the HTML keeps the Spanish source, and data-i18n="key" (text), data-i18n-html="key" (trusted markup
// from the dictionary) and data-i18n-<attr>="key" for these attributes swap it for the dictionary text.
const ATTRS = ['aria-label', 'title', 'placeholder', 'alt', 'content'];
export function applyTexts(t, root = document) {
  for (const el of root.querySelectorAll('[data-i18n]')) el.textContent = t(el.dataset.i18n);
  for (const el of root.querySelectorAll('[data-i18n-html]')) el.innerHTML = t(el.dataset.i18nHtml);
  for (const attr of ATTRS) {
    for (const el of root.querySelectorAll(`[data-i18n-${attr}]`)) el.setAttribute(attr, t(el.getAttribute(`data-i18n-${attr}`)));
  }
}

/** Reloads the page in `next`, saved and in the address. */
export function switchLang(next) {
  storeLang(next);
  const url = new URL(location.href);
  url.searchParams.set(QUERY_KEY, next);
  location.replace(url.href);
}

/**
 * The ES / EN switch: a group of two buttons inside `host` (appended, or before `before`). `buttonClass` reuses the
 * screen's own button style. By default a switch reloads the page in the other language; `onChange(lang)` replaces
 * that for a screen that can repaint in place.
 */
export function mountLangToggle(host, { lang, label = lang === 'en' ? 'Language' : 'Idioma', buttonClass = '', className = '', onChange = switchLang, before = null } = {}) {
  const group = document.createElement('div');
  group.className = `lang-toggle ${className}`.trim();
  group.setAttribute('role', 'group');
  group.setAttribute('aria-label', label);
  for (const code of LANGS) {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = buttonClass;
    b.dataset.setLang = code;
    b.lang = code;
    b.textContent = code.toUpperCase();
    b.setAttribute('aria-label', code === 'es' ? 'Español' : 'English');
    b.setAttribute('aria-pressed', String(code === lang));
    b.addEventListener('click', () => { if (code !== lang) onChange(code); });
    group.append(b);
  }
  host.insertBefore(group, before);
  return group;
}

/**
 * Carries the language on every relative link of the page as it is followed (also links painted later), so the next
 * screen opens in it even where localStorage is blocked. External links are left alone. `lang` can be a function, for
 * a screen that switches language in place.
 */
export function carryLang(lang, root = document) {
  const stamp = (e) => {
    const a = e.target.closest?.('a[href]');
    if (!a) return;
    const href = a.getAttribute('href');
    const next = withLang(href, typeof lang === 'function' ? lang() : lang);
    if (next !== href) a.setAttribute('href', next);
  };
  root.addEventListener('click', stamp, true);
  root.addEventListener('auxclick', stamp, true);
  root.addEventListener('contextmenu', stamp, true);
}
