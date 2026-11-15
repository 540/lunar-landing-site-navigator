// The one version of three.js of the site (G1.2, #140). Every page loads it from the CDN with an import map
// (home/, web/, viewpoint/ and rolegame/); tests/moon-globe.test.mjs checks they all say this one.
export const THREE_VERSION = '0.160.0';
export const THREE_URL = `https://cdn.jsdelivr.net/npm/three@${THREE_VERSION}/build/three.module.js`;
