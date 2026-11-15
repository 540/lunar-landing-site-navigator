// State machine of the cabin controls. Pure: the scene reads `visual()` to draw each control and `systems()` to know
// what the vehicle can do; `press()` returns the new state plus the events (sounds, messages) the change produces.

const toggle = (id, label, on = false, extra = {}) => ({ id, kind: 'toggle', label, on, ...extra });
const button = (id, label, on = false, extra = {}) => ({ id, kind: 'button', label, on, ...extra });
const guarded = (id, label, on = false, extra = {}) => ({ id, kind: 'guarded', label, on, ...extra });
const rotary = (id, label, positions, pos = 0, extra = {}) => ({ id, kind: 'rotary', label, positions, pos, ...extra });
const breaker = (id, label) => ({ id, kind: 'breaker', label, on: true });
const lamps = (prefix, labels, on, kind = toggle) => labels.map((label, i) => kind(`${prefix}${i + 1}`, label, typeof on === 'function' ? on(i) : on));

export const COVER_CLOSE_S = 5;
export const THROTTLE_STEP = 0.1;

// Controls that fly the vehicle. The rest only change their own light.
export const FLIGHT_CONTROLS = [
  guarded('engineArm', 'ARMAR MOTOR', false, { color: 'amber' }),
  toggle('propValves', 'VÁLV PROPELENTE', true),
  button('autopilot', 'PILOTO AUTO', true, { color: 'green' }),
  toggle('gnc', 'ORDENADOR GNC', true),
  toggle('rcs', 'RCS', true),
  guarded('gear', 'TREN', false, { color: 'green' }),
  guarded('abort', 'ABORTAR', false, { color: 'red', latch: true }),
  button('masterAlarm', 'ALARMA', false, { color: 'red', momentary: true }),
  toggle('radarAlt', 'RADAR ALTÍM', true),
  rotary('cabinLights', 'LUZ CABINA', ['OFF', 'BAJA', 'ALTA'], 1),
  toggle('panelLights', 'LUZ PANELES', true),
  toggle('landingLights', 'FOCOS ATERR', false),
  rotary('camera', 'MFD DCHA', ['SISTEMAS', 'CÁM SUELO', 'RUTA'], 0),
  toggle('mfdLeft', 'MFD IZQ', true),
  toggle('mfdCenter', 'MFD CENTRO', true),
  toggle('mfdRight', 'MFD DCHA', true),
  { id: 'throttle', kind: 'lever', label: 'EMPUJE', value: 0 },
  { id: 'stick', kind: 'stick', label: 'ACTITUD' },
];

export const COSMETIC_CONTROLS = [
  // Main panel, left wing: propulsion
  ...lamps('prop', ['BOMBA COMB A', 'BOMBA COMB B', 'PRES HELIO', 'VÁLV OXID', 'CALENT MOTOR', 'PURGA'], i => i !== 5 && i !== 1),
  // Main panel, right wing: communications
  ...lamps('comm', ['BANDA S', 'VHF A', 'VHF B', 'UHF', 'TRANSPONDER', 'GRABADORA'], i => i < 2 || i === 4),
  // Keys under the screens
  ...lamps('keyL', ['ACT', 'NAV', 'VEL', 'ALT', 'RUTA', 'SIS'], i => i === 0, button),
  ...lamps('keyC', ['PROG', 'VERB', 'NOMB', 'INTRO', 'BORRA', 'TECLA'], false, button),
  ...lamps('keyR', ['MAPA', 'CÁM', 'ECLSS', 'ELEC', 'COM', 'MENÚ'], i => i === 2, button),
  // Pedestal
  ...lamps('ped', ['IMU', 'RASTR ESTELAR', 'GNC 2', 'HOLD ACT', 'MODO DESC', 'TRIM'], i => i < 2 || i === 4),
  rotary('pedMode', 'MODO RADAR', ['BÚSQ', 'ALT', 'VEL'], 1),
  rotary('pedRate', 'ESCALA', ['5', '25', 'MÁX'], 1),
  // Overhead: electrical and life support
  ...lamps('bat', ['BAT 1', 'BAT 2', 'BAT 3', 'BAT 4', 'BUS A', 'BUS B', 'ENLACE BUS', 'INVERSOR 1', 'INVERSOR 2', 'CÉLULA COMB'], i => i !== 6 && i !== 8),
  ...lamps('ecl', ['VENT TRAJE 1', 'VENT TRAJE 2', 'DEPUR CO₂', 'SEP AGUA', 'BOMBA GLICOL', 'VENT CABINA', 'O₂ PRINC', 'O₂ RESERVA', 'CALEFACTOR', 'RADIADOR'], i => i !== 1 && i !== 7),
  ...lamps('ext', ['LUZ ANTICOL', 'LUZ ATRAQUE', 'BALIZA', 'CÁM EXT', 'ANTENA AG', 'DESHIELO'], i => i === 2 || i === 4),
  rotary('ohTemp', 'TEMP CABINA', ['18', '21', '24'], 1),
  rotary('ohPress', 'PRESIÓN', ['34', '57', '101'], 1),
  ...Array.from({ length: 36 }, (_, i) => breaker(`cb${i + 1}`, `DISY ${i + 1}`)),
  // Side consoles
  ...lamps('sideL', ['AUDIO CDR', 'INTERCOM', 'VOX', 'LUZ MAPA', 'CALENT GUANTE', 'AGUA'], i => i < 3),
  rotary('sideLVol', 'VOLUMEN', ['1', '2', '3', '4'], 2),
  ...lamps('sideR', ['AUDIO PLT', 'INTERCOM', 'VOX', 'LUZ MAPA', 'VENT VISOR', 'REGISTRO'], i => i < 3 || i === 5),
  rotary('sideRVol', 'VOLUMEN', ['1', '2', '3', '4'], 1),
  // Rear equipment rack
  ...lamps('rack', ['DATOS A', 'DATOS B', 'TELEMETRÍA', 'CIENCIA', 'MUESTRAS', 'ESCLUSA'], i => i < 3),
];

export const CONTROLS = [...FLIGHT_CONTROLS, ...COSMETIC_CONTROLS];
const BY_ID = new Map(CONTROLS.map(c => [c.id, c]));
export const controlById = id => BY_ID.get(id);

export function createControls() {
  const values = {};
  for (const c of CONTROLS) {
    values[c.id] = c.kind === 'rotary' ? { pos: c.pos } : c.kind === 'lever' ? { value: c.value } : c.kind === 'guarded' ? { on: c.on, cover: false, coverT: 0 } : c.kind === 'stick' ? {} : { on: c.on };
  }
  return { values, alarm: false };
}

const withValue = (state, id, patch) => ({ ...state, values: { ...state.values, [id]: { ...state.values[id], ...patch } } });

/** Click on a control. `dir` is +1 or -1 for rotaries and levers. Returns { state, events }. */
export function press(state, id, dir = 1) {
  const def = BY_ID.get(id), v = state.values[id];
  if (!def) return { state, events: [] };
  const events = [];
  let next = state;
  switch (def.kind) {
    case 'toggle':
    case 'breaker':
      next = withValue(state, id, { on: !v.on });
      events.push({ type: 'sound', name: def.kind === 'breaker' ? 'breaker' : 'switch' });
      break;
    case 'button':
      if (def.momentary) {
        next = { ...state, alarm: false };
        events.push({ type: 'sound', name: 'button' }, { type: 'ack' });
      } else {
        next = withValue(state, id, { on: !v.on });
        events.push({ type: 'sound', name: 'button' });
      }
      break;
    case 'guarded':
      if (!v.cover) {
        next = withValue(state, id, { cover: true, coverT: 0 });
        events.push({ type: 'sound', name: 'cover' }, { type: 'hint', code: 'coverOpen', id });
      } else if (def.latch && v.on) {
        events.push({ type: 'sound', name: 'denied' });
      } else {
        next = withValue(state, id, { on: !v.on, coverT: 0 });
        // The «press again» hint of the cover no longer applies once the switch has been thrown.
        events.push({ type: 'sound', name: 'switch' }, { type: 'clearHint', id });
      }
      break;
    case 'rotary': {
      const n = def.positions.length;
      next = withValue(state, id, { pos: (v.pos + (dir < 0 ? n - 1 : 1)) % n });
      events.push({ type: 'sound', name: 'knob' });
      break;
    }
    case 'lever':
      next = setThrottle(state, v.value + THROTTLE_STEP * (dir < 0 ? -1 : 1));
      events.push({ type: 'sound', name: 'lever' });
      break;
    case 'stick':
      events.push({ type: 'hint', code: 'stick', id });
      break;
  }
  if (next !== state) {
    // The guidance computer flies the autopilot: without it the autopilot drops out, and it cannot be engaged.
    if (!next.values.gnc.on && next.values.autopilot.on) {
      next = { ...withValue(next, 'autopilot', { on: false }), alarm: true };
      events.push({ type: 'hint', code: id === 'autopilot' ? 'needsGnc' : 'autopilotLost', id }, { type: 'sound', name: 'denied' });
    }
    events.push({ type: 'change', id });
  }
  return { state: next, events };
}

export function setThrottle(state, value) {
  return withValue(state, 'throttle', { value: Math.round(Math.min(1, Math.max(0, value)) * 100) / 100 });
}

/** Safety covers close by themselves a few seconds after the last touch. */
export function tick(state, dt) {
  let next = state;
  for (const c of CONTROLS) {
    if (c.kind !== 'guarded') continue;
    const v = next.values[c.id];
    if (!v.cover) continue;
    const coverT = v.coverT + dt;
    next = withValue(next, c.id, coverT >= COVER_CLOSE_S ? { cover: false, coverT: 0 } : { coverT });
  }
  return next;
}

export const raiseAlarm = state => (state.alarm ? state : { ...state, alarm: true });

/** What a crash does to the cabin: the cabin and panel lights go out and the master alarm goes off. */
export const powerFailure = state => raiseAlarm(withValue(withValue(state, 'cabinLights', { pos: 0 }), 'panelLights', { on: false }));

/** What the vehicle can do with the controls as they are. */
export function systems(state) {
  const v = state.values;
  return {
    engine: v.engineArm.on && v.propValves.on,
    engineArmed: v.engineArm.on,
    autopilot: v.autopilot.on && v.gnc.on,
    rcs: v.rcs.on,
    gear: v.gear.on,
    abort: v.abort.on,
    radar: v.radarAlt.on,
    throttle: v.throttle.value,
    cabinLights: v.cabinLights.pos,
    panelLights: v.panelLights.on,
    landingLights: v.landingLights.on,
    camera: v.camera.pos,
    mfd: { left: v.mfdLeft.on, center: v.mfdCenter.on, right: v.mfdRight.on },
    alarm: state.alarm,
  };
}

/** How a control looks: { on, cover, pos, value } with the light it shows. */
export function visual(state, id) {
  const def = BY_ID.get(id), v = state.values[id];
  if (id === 'masterAlarm') return { on: state.alarm };
  if (def.kind === 'rotary') return { pos: v.pos, on: v.pos > 0 };
  if (def.kind === 'lever') return { value: v.value, on: v.value > 0 };
  if (def.kind === 'guarded') return { on: v.on, cover: v.cover };
  return { on: !!v.on };
}

/** Sets a switch straight to a position: what the crew (or a keyboard shortcut) does, safety cover included. */
export function setOn(state, id, on) {
  const def = BY_ID.get(id), v = state.values[id];
  if (!def || v.on === on || (def.latch && v.on)) return state;
  return withValue(state, id, def.kind === 'guarded' ? { on, cover: true, coverT: COVER_CLOSE_S - 1.2 } : { on });
}
