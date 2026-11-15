// Static texts of index.html in the language of the page. app.js imports this first, so the views find the English
// already in place when their modules read labels at import (e.g. the aria-label of a canvas).
import { t, lang } from './i18n.js';
import { applyTexts, mountLangToggle, carryLang } from '../../../shared/i18n/page.js';

if (lang === 'en') applyTexts(t);
const theme = document.getElementById('btn-theme');
mountLangToggle(theme.parentElement, { lang, className: 'segmented', before: theme });
carryLang(lang);
