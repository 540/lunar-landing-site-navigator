// The same checks as control-cases-ui.test.js, with the page opened in English (?lang=en): each test file runs in its
// own process, so the language is fixed before the views load.
process.env.SOURCES_TEST_LANG = 'en';
await import('./control-cases-ui.test.js');
