// "3D not available" notice of the Mirador (G1.2b, #286): #glost in index.html, with the logic of the home page's
// (shared/render/lost-notice.js). The two doors of the Mirador, exploration (main.js) and mission viewer (mission.js),
// create it here and hand it to createScene, which shows it when the renderer cannot be created or the context is lost.
import { createLostNotice } from '../../shared/render/lost-notice.js';
import { UI } from './texts.js';

/** Fills in the texts of #glost, wires «Recargar» and returns the notice ({ show, hide, visible }).
 *  plannerHref: where «Simulador de misiones» goes; the mission viewer passes the plan it came from (planUrl), so the
 *  user gets back to it while the rest of the page, «Volver» included, is inert. Without it, the link stays ../web/.
 *  beforeShow: runs right before the notice shows; exploration passes endTour, because the first-visit tutorial makes
 *  every child of body inert, #glost included, and it would leave the notice's links and «Recargar» dead. */
export function setupLostNotice({ doc = document, reload = () => location.reload(), plannerHref = null, beforeShow = () => {} } = {}) {
  const $ = id => doc.getElementById(id);
  const T = UI.lost;
  const notice = $('glost');
  notice.setAttribute('aria-label', T.label);
  $('glost-text').textContent = T.text;
  $('glost-home').textContent = T.home;
  $('glost-planner').textContent = T.planner;
  if (plannerHref) $('glost-planner').href = plannerHref;
  $('glost-reload').textContent = T.reload;
  $('glost-reload').addEventListener('click', () => reload());
  // While it shows, the rest of the page is inert; when it goes away, focus goes back, or to «Volver».
  const lost = createLostNotice({ notice, loading: null, roots: [doc.body], fallbackFocus: () => doc.querySelector('.back') });
  const show = lost.show;
  // Whoever made the page inert before (the tutorial) must not keep the notice inert: it is the one thing left to use.
  lost.show = () => {
    if (notice.hidden) beforeShow();
    notice.inert = false;
    show();
  };
  return lost;
}

/** onRestore of the scene's watchContextLoss: three.js has rebuilt its state, so the scene is drawn again, with its
 *  shadow map, which is only redrawn when flagged. */
export function redrawAfterRestore({ light, renderer, scene, camera }) {
  light.shadow.needsUpdate = true;
  renderer.render(scene, camera);
}
