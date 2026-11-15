// UI helpers: DOM access and theme colours. Visible numbers and dates: the formatters of common/i18n.js (#343).
export const $ = id => document.getElementById(id);
export const css = n => getComputedStyle(document.documentElement).getPropertyValue(n).trim();
export const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
export const linkify = s => esc(s).replace(/https?:\/\/[^\s)]+/g, u => `<a href="${u}" target="_blank" rel="noopener">${u}</a>`);
export const isoLocal = ms => new Date(ms).toISOString().slice(0, 16);

// Theme colour of each verdict code.
export const verdictColor = code => css({ viable: '--color-ok', marginal: '--color-warn', not_viable: '--color-bad' }[code]);
