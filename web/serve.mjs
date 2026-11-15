#!/usr/bin/env node
// Shortcut to work on the planner: node web/serve.mjs → http://localhost:4542 opens the planner.
// It starts the site server (../serve.mjs), so the link back to the home works too.
process.env.PORT ||= '4542';
process.env.ENTRY ||= 'web';
await import('../serve.mjs');
