// The buttons into virtual reality (#396), both only where they can work, so without a headset nothing changes:
// - «Entrar en VR»: a WebXR headset (Meta Quest and others), where the browser says one can open an immersive session.
// - PS VR (experimental, only with ?psvr=1 in the address): «Conectar PS VR» and then «Entrar en VR (PS VR)», the
//   PlayStation VR of the PS4 on a computer, through WebHID (psvr.js), in two clicks, since the browser asks for one for
//   each permission (the device, then the full screen on the headset's screen). Esc leaves it. Without the parameter its
//   button and log are not even created and psvr.js is not loaded, so nothing of WebHID or WebUSB is touched.
// From the drone both go down on foot first.
import { UI } from './texts.js';
import { offersPSVR } from './core/psvr.js';

/** @param {object} scene the scene (createScene with explore: true); its view.foot has the virtual reality calls */
export async function setupXR(scene) {
  const view = scene?.foot;
  if (!view?.startXR) return;
  const T = UI.xr;
  if (offersPSVR({ search: location.search, hasHid: 'hid' in navigator, secure: window.isSecureContext })) {
    setupPSVR(view, T).catch(err => console.warn('PS VR', err));
  }
  const button = document.getElementById('xr-btn'), status = document.getElementById('foot-status');
  const supported = !!navigator.xr && window.isSecureContext && await navigator.xr.isSessionSupported('immersive-vr').catch(() => false);
  if (!button || !supported) return;
  const paint = on => { button.textContent = on ? T.exit : T.enter; button.setAttribute('aria-pressed', String(on)); };
  paint(false);
  button.hidden = false;
  view.onXR(on => { if (!view.inPSVR) paint(on); });
  button.addEventListener('click', async () => {
    if (view.inXR) { view.exitXR(); return; }
    button.disabled = true;
    try {
      await view.startXR();
    } catch (err) {
      // the scene has undone what it had done and closed the session: you stay on foot, as before
      console.warn('No se ha podido entrar en VR', err);
      if (status) status.textContent = T.enterFailed;
      paint(false);
    } finally { button.disabled = false; }
  });
}

/** The PS VR button and its log are made here, only when it is offered. */
async function setupPSVR(view, T) {
  const { canUseUSB, connectPSVR, connectPSVRControl, fullscreenOnHeadset } = await import('./psvr.js');
  const side = document.querySelector('.side'), status = document.getElementById('foot-status');
  if (!side) return;
  const button = document.createElement('button');
  button.type = 'button'; button.className = 'foot-btn xr-btn'; button.id = 'psvr-btn'; button.hidden = true;
  side.insertBefore(button, document.getElementById('xr-btn')?.nextSibling ?? null);
  const panel = document.createElement('section');
  panel.className = 'psvr-log'; panel.id = 'psvr-log'; panel.hidden = true; panel.setAttribute('aria-labelledby', 'psvr-log-title');
  panel.innerHTML = '<h2 class="psvr-log__title" id="psvr-log-title"></h2><pre class="psvr-log__text mono" id="psvr-log-text" role="log" aria-live="polite"></pre><button type="button" class="gesture-panel__recal" id="psvr-log-close"></button>';
  document.body.append(panel);
  let headset = null, usbTried = false; // after one try over USB, go on: VR mode may come from elsewhere (macOS script)
  // the log of the connection, shown: what was found, what was sent, what came back
  const text = panel.querySelector('#psvr-log-text'), close = panel.querySelector('#psvr-log-close');
  panel.querySelector('#psvr-log-title').textContent = T.psvrLogTitle;
  close.textContent = T.psvrLogClose;
  close.addEventListener('click', () => { panel.hidden = true; });
  const log = line => { panel.hidden = false; text.textContent += `${line}
`; text.scrollTop = text.scrollHeight; console.info('PS VR', line); };
  const say = msg => { if (status) status.textContent = msg; button.title = msg; log(msg); };
  // connect (the sensor, WebHID) → turn VR mode on over USB if HID did not (WinUSB, Windows) → into the headset
  const paint = () => {
    button.textContent = view.inPSVR ? T.psvrExit : !headset ? T.psvrConnect : !headset.vrMode && canUseUSB() && !usbTried ? T.psvrUsb : T.psvrEnter;
  };
  paint();
  button.hidden = false;
  button.addEventListener('click', async () => {
    button.disabled = true;
    try {
      if (!headset) {
        text.textContent = '';
        headset = await connectPSVR(log);
        say(headset.vrMode ? T.psvrReady : canUseUSB() ? T.psvrNeedUsb : T.psvrNoVR);
      } else if (!headset.vrMode && canUseUSB() && !usbTried) {
        usbTried = true;
        const ctl = await connectPSVRControl(log, { ask: true });
        if (!ctl) { say(T.psvrUsbError); return; }
        await headset.useControl(ctl);
        say(T.psvrReady);
      } else if (!view.inPSVR) {
        document.body.classList.add('is-psvr');
        panel.hidden = true;
        const found = await fullscreenOnHeadset(document.documentElement, log);
        if (!found) say(T.psvrNoScreen);
        view.startPSVR(headset);
      }
    } catch (err) {
      console.warn('PS VR', err);
      document.body.classList.remove('is-psvr');
      log(T.log.error(err?.message ?? err));
      say(T.psvrError);
    } finally {
      button.disabled = false;
      paint();
    }
  });
  // Esc (or anything that ends the full screen) leaves the PS VR, and you stay on foot
  const leave = () => {
    if (!view.inPSVR) return;
    view.stopPSVR();
    document.body.classList.remove('is-psvr');
    if (document.fullscreenElement) document.exitFullscreen().catch(() => {});
    paint();
  };
  document.addEventListener('fullscreenchange', () => { if (!document.fullscreenElement) leave(); });
  addEventListener('keydown', ev => { if (ev.key === 'Escape' && view.inPSVR) { ev.preventDefault(); leave(); } });
  addEventListener('pagehide', () => { headset?.close(); });
}
