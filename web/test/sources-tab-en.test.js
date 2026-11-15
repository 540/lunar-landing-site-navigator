// The same checks as sources-tab.test.js, with the page opened in English (?lang=en): each test file runs in its own
// process, so the language is fixed before the view loads.
process.env.SOURCES_TEST_LANG = 'en';
await import('./sources-tab.test.js');
