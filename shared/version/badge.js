// Version of the site and the notice of AI use (#96), in the bottom left corner of every screen. The version comes from
// /version.json, which the Pages build writes before each deploy (tools/version/next.mjs) and serve.mjs answers locally;
// without it, only the AI notice is shown.
// Each screen loads it with <script type="module" src="../shared/version/badge.js"></script>.

export function badgeText(info) {
  return typeof info?.version === 'string' && /^\d+\.\d+\.\d+/.test(info.version) ? `v${info.version}` : null;
}

/** The notice of AI use every screen shows (Space Apps asks to declare it): Spanish unless the page is in English. */
export function aiNoticeText(lang) {
  return lang === 'en' ? 'Built with AI assistance · Claude Code' : 'Hecho con ayuda de IA · Claude Code';
}

async function show() {
  let info = null;
  try {
    const res = await fetch(new URL('../../version.json', import.meta.url), { cache: 'no-cache' });
    if (res.ok) info = await res.json();
  } catch {
    // No version.json: the AI notice goes alone
  }
  const version = badgeText(info);
  const badge = document.createElement('div');
  badge.id = 'site-version';
  const paint = () => {
    const en = document.documentElement.lang === 'en';
    const notice = aiNoticeText(en ? 'en' : 'es');
    badge.textContent = version ? `${version} · ${notice}` : notice;
    badge.setAttribute('aria-label', version ? `${en ? 'Version' : 'Versión'} ${version.slice(1)}. ${notice}` : notice);
  };
  paint();
  // The screens with a language switch change <html lang> without reloading
  new MutationObserver(paint).observe(document.documentElement, { attributes: true, attributeFilter: ['lang'] });
  if (info?.commit) badge.dataset.commit = String(info.commit);
  // Inline and neutral: the screens do not share a stylesheet, and this grey reads on the dark and the light theme.
  badge.style.cssText = 'position:fixed;left:8px;bottom:5px;z-index:2147483000;pointer-events:none;user-select:none;'
    + 'font:500 11px/1 ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;letter-spacing:.02em;color:#8a8f98;opacity:.85';
  document.body.append(badge);
}

if (typeof document !== 'undefined') show();
