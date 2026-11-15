// PlayStation VR (PS4) straight from the browser (#396), with nothing to install: WebHID reaches the processor unit (power
// on, VR mode, the head's sensor) and the Window Management API puts the page full screen on the headset's screen, a
// monitor of the computer. Chrome and Edge on a computer. The bytes and the fusion are pure, in core/psvr.js.
//
// The protocol is not Sony's: it comes from the community, and each system hands the interfaces a little differently. So
// the connection does not take one layout for granted, and it writes what it found in a log that the page shows.
import { UI } from './texts.js';
import { PSVR_VENDOR_ID, PSVR_PRODUCT_ID, COMMANDS, CONTROL_INTERFACE, commandFrame, isControlInterface, parseSensorReport, tickDelta, createHeadFusion } from './core/psvr.js';

const L = () => UI.xr.log; // the texts of the log (texts.js), read when used so the language is the one in use
/** WebUSB is there: the way to the control interface once it has the WinUSB driver (Windows, with Zadig). */
// macOS keeps the HID interfaces to itself, so WebUSB never reaches the control there: VR mode comes from a script.
const isMac = () => /Mac/i.test(navigator.userAgentData?.platform ?? navigator.platform ?? '');
export const canUseUSB = () => typeof navigator !== 'undefined' && 'usb' in navigator && window.isSecureContext && !isMac();

/**
 * The control interface over WebUSB. On Windows the system's HID driver does not let the commands through, as on macOS:
 * with Zadig, the control interface (number 5) gets the WinUSB driver once, and Chrome reaches it as a USB interface.
 * `ask`: show the browser's list of USB devices (it needs a click); without it, only a headset already allowed.
 * @returns {Promise<{send:(command:object)=>Promise<void>, close:()=>Promise<void>}|null>}
 */
export async function connectPSVRControl(log = () => {}, { ask = false } = {}) {
  if (!canUseUSB()) return null;
  const filters = [{ vendorId: PSVR_VENDOR_ID, productId: PSVR_PRODUCT_ID }];
  let device = (await navigator.usb.getDevices()).find(d => d.vendorId === PSVR_VENDOR_ID && d.productId === PSVR_PRODUCT_ID) ?? null;
  if (!device && ask) device = await navigator.usb.requestDevice({ filters });
  if (!device) return null;
  await device.open();
  if (!device.configuration) await device.selectConfiguration(1);
  const interfaces = device.configuration.interfaces;
  log(L().usbInterfaces(interfaces.length, interfaces.map(i => L().usbInterface(i.interfaceNumber, i.claimed, i.alternate.interfaceClass)).join(', ')));
  // the control interface first, then any other with an OUT endpoint that the system lets us claim
  const order = [...interfaces].sort((a, b) => (a.interfaceNumber === CONTROL_INTERFACE ? -1 : 0) - (b.interfaceNumber === CONTROL_INTERFACE ? -1 : 0));
  for (const iface of order) {
    const out = iface.alternate.endpoints.find(e => e.direction === 'out');
    if (!out) continue;
    try {
      await device.claimInterface(iface.interfaceNumber);
    } catch (err) {
      log(L().usbInterfaceFails(iface.interfaceNumber, err.message, iface.interfaceNumber === CONTROL_INTERFACE));
      continue;
    }
    log(L().usbInterfaceReady(iface.interfaceNumber, out.endpointNumber));
    return {
      async send(command) {
        const r = await device.transferOut(out.endpointNumber, commandFrame(command));
        if (r.status !== 'ok') throw new Error(`USB ${r.status}`);
      },
      async close() { await device.releaseInterface(iface.interfaceNumber).catch(() => {}); await device.close().catch(() => {}); },
    };
  }
  log(L().usbNone);
  await device.close().catch(() => {});
  return null;
}

/** Powers the headset on, VR mode and tracking, through a control that has a send(command). */
async function startVR(send, log, where) {
  for (const [name, c] of [[L().commands.powerOn, COMMANDS.powerOn], [L().commands.vrMode, COMMANDS.vrMode], [L().commands.tracking, COMMANDS.tracking]]) {
    await send(c);
    log(L().sent(name, hex(c.reportId), where));
    await wait(300);
  }
}

const wait = ms => new Promise(r => setTimeout(r, ms));
const hex = n => `0x${n.toString(16).padStart(2, '0')}`;

/** One line per interface: its usages and its reports (id and size in bytes), for the log. */
export function describeDevice(d, i) {
  const cols = (d.collections ?? []).map(c => {
    const list = (rs = []) => rs.map(r => `${r.reportId}:${Math.round((r.items ?? []).reduce((n, it) => n + (it.reportSize ?? 0) * (it.reportCount ?? 0), 0) / 8)}B`).join(',') || '–';
    return L().collection(hex(c.usagePage ?? 0), hex(c.usage ?? 0), list(c.inputReports), list(c.outputReports), list(c.featureReports));
  });
  return L().device(i, d.productName || '?', d.opened, cols.join(' ') || L().noCollections);
}

/**
 * Where the commands may go: the interface that declares report 0x23 first, then those with output reports, then the rest
 * but the sensor (on macOS the control interface shows only feature reports in its descriptor, so none qualifies).
 */
function controlCandidates(devices, sensor) {
  const outputs = d => (d.collections ?? []).some(c => (c.outputReports ?? []).length);
  const first = devices.filter(d => isControlInterface(d.collections));
  const second = devices.filter(d => !first.includes(d) && outputs(d));
  return [...first, ...second, ...devices.filter(d => !first.includes(d) && !second.includes(d) && d !== sensor)];
}

/** Sends one command, as an output report and, if the system refuses it, as a feature report. Returns how it went. */
async function sendCommand(d, { reportId, data }) {
  const bytes = new Uint8Array(data);
  try { await d.sendReport(reportId, bytes); return L().way.output; } catch (outErr) {
    try { await d.sendFeatureReport(reportId, bytes); return L().way.feature; } catch (featErr) {
      throw new Error(L().sendFailed(outErr.message, featErr.message));
    }
  }
}

/**
 * Asks for the headset (the browser shows its list of devices), powers it on and puts it in VR mode, and starts reading
 * its sensor. Needs a click: the browser only shows its list in answer to one. `log(line)` hears every step.
 * @returns {Promise<{orientation:()=>{x,y,z,w}, recenter:()=>void, worn:()=>boolean, reports:()=>number, close:()=>Promise<void>}>}
 */
export async function connectPSVR(log = () => {}) {
  const filters = [{ vendorId: PSVR_VENDOR_ID, productId: PSVR_PRODUCT_ID }];
  const isPSVR = d => d.vendorId === PSVR_VENDOR_ID && d.productId === PSVR_PRODUCT_ID;
  // Already allowed: no list (Chrome shows an allowed device as «vinculado» and does not let it be chosen again).
  let chosen = (await navigator.hid.getDevices()).filter(isPSVR);
  if (!chosen.length) chosen = await navigator.hid.requestDevice({ filters });
  if (!chosen.length) throw new Error(L().noneChosen);
  // Each interface of the processor unit is a device of its own: the chooser may give one, and the rest are already allowed.
  const known = await navigator.hid.getDevices();
  const all = [...new Set([...chosen, ...known])].filter(d => d.vendorId === PSVR_VENDOR_ID && d.productId === PSVR_PRODUCT_ID);
  log(L().hidInterfaces(all.length));
  for (const d of all) {
    if (!d.opened) await d.open().catch(err => log(L().openFails(err.message)));
  }
  all.forEach((d, i) => log(describeDevice(d, i)));
  // The sensor: every report of every interface, kept if it reads as one (64 bytes, or 63 without its first byte).
  const fusion = createHeadFusion();
  let lastTick = 0, worn = false, centred = false, samples = 0, reports = 0;
  const sizes = new Map();
  const onReport = ev => {
    const n = ev.data.byteLength;
    sizes.set(`${ev.reportId}:${n}B`, (sizes.get(`${ev.reportId}:${n}B`) ?? 0) + 1);
    const r = parseSensorReport(new Uint8Array(ev.data.buffer, ev.data.byteOffset, n));
    if (!r) return;
    reports++;
    worn = r.worn;
    for (const s of r.samples) {
      fusion.update(s.gyro, s.accel, tickDelta(s.tick, lastTick));
      lastTick = s.tick;
      // where you look after the first second (the tilt has settled) is ahead
      if (!centred && ++samples > 2000) { fusion.recenter(); centred = true; }
    }
  };
  let sensor = null;
  const onAnyReport = ev => { if (!sensor && ev.data.byteLength >= 63) sensor = ev.target ?? ev.device; };
  for (const d of all) if (d.opened) { d.addEventListener('inputreport', onReport); d.addEventListener('inputreport', onAnyReport); }
  await wait(300); // a moment to see which interface streams the sensor, so the commands do not go there
  // The commands: power on, VR mode, tracking (OpenHMD's order), on the first interface that takes them.
  let control = null; // a send(command) that works: through HID if the system lets it, or else WebUSB
  for (const d of controlCandidates(all.filter(d => d.opened), sensor)) {
    try {
      const send = async c => { await sendCommand(d, c); };
      await startVR(send, log, L().viaHid(all.indexOf(d)));
      control = send;
      break;
    } catch (err) {
      log(L().hidRefuses(all.indexOf(d), err.message));
    }
  }
  // a USB control already allowed (WinUSB on Windows): no list to show, so it works in this same click
  let usb = null;
  if (!control) {
    try {
      usb = await connectPSVRControl(log);
      if (usb) { await startVR(usb.send, log, L().viaUsb); control = usb.send; }
    } catch (err) { log(L().usbError(err.message)); usb = null; }
  }
  if (!control) log(L().noControl);
  await wait(1200);
  log(L().reports([...sizes].map(([k, v]) => `${k}×${v}`).join(', '), reports));
  if (!control && !reports) throw new Error(L().notResponding);
  const headset = {
    vrMode: !!control,
    /** The VR mode through a USB control (connectPSVRControl), when HID did not let it through. */
    async useControl(ctl) {
      await startVR(ctl.send, log, L().viaUsb);
      usb = ctl; control = ctl.send; headset.vrMode = true;
    },
    orientation: () => fusion.orientation,
    recenter: () => fusion.recenter(),
    worn: () => worn,
    reports: () => reports,
    async close() {
      for (const d of all) { d.removeEventListener('inputreport', onReport); d.removeEventListener('inputreport', onAnyReport); }
      if (control) await control(COMMANDS.cinematicMode).catch(() => {});
      await usb?.close();
      for (const d of all) await d.close().catch(() => {});
    },
  };
  return headset;
}

/**
 * Full screen on the headset's screen: the screen the system calls PS VR, or else the other 1920 × 1080 one. Needs a
 * click. Without the Window Management API, full screen where the window is (drag it to the headset's screen first).
 * @returns {Promise<string|null>} the label of the screen found, or null
 */
export async function fullscreenOnHeadset(element, log = () => {}) {
  let screen = null;
  if ('getScreenDetails' in window) {
    try {
      const details = await window.getScreenDetails();
      log(L().screens(details.screens.map(s => `${s.label || '?'} ${s.width}×${s.height}${s.isPrimary ? L().screenMain : ''}`).join(' · ')));
      screen = details.screens.find(s => /psvr|playstation|sony|sie|hmd/i.test(s.label))
        ?? details.screens.find(s => !s.isPrimary && s.width === 1920 && s.height === 1080)
        ?? details.screens.find(s => !s.isPrimary) ?? null;
    } catch (err) { log(L().noScreenPermission(err.message)); screen = null; }
  } else log(L().noScreenChoice);
  await element.requestFullscreen(screen ? { screen, navigationUI: 'hide' } : { navigationUI: 'hide' });
  return screen ? (screen.label || `${screen.width}×${screen.height}`) : null;
}
