// Sets the theme on <html> before the page paints, so it never flashes dark then light.
// Classic script (not a module) loaded in <head>: the saved choice wins, otherwise dark (the default: it is space).
// The toggle and the canvases use js/common/theme.js, which reads and writes the same key.
(function () {
  var saved = null;
  try { saved = localStorage.getItem('llsn.theme'); } catch (e) { /* storage blocked: dark */ }
  document.documentElement.dataset.theme = saved === 'light' ? 'light' : 'dark';
})();
