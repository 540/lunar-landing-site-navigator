// Every text the player sees on this screen. HTML and JS never hardcode visible copy.
// TEXTS is the Spanish dictionary; the English one is in texts.en.js (J10.1). texts(lang) gives the one in use.
import { EN } from './texts.en.js';
import { bearing } from '../../web/js/common/sky-polar.js';
import { num, deg as degrees } from '../../shared/format/number.js';
import { dayMonthTime } from '../../shared/format/time.js';

// Numbers through shared/format/ (#343): «−» in negatives and thousands grouped also with four digits.
const fmt = (v, max = 1) => num('es', v, max);
const fmt1 = (v) => num('es', v, 1, 1);
// Whole numbers with the thousands point also under 10 000 («1.470»), as written in Spanish texts.
const int = (v) => num('es', v, 3);

// Degrees with one decimal, for the 3D Moon summary.
const deg = (v) => degrees('es', v, 1, 1);
// Days the Earth shows up and hides in this game (J9.4), from facts of scenario.json.
const isFacts = (f) => f !== null && typeof f === 'object';
const earthWindowEs = (f) => (isFacts(f) && f.earthFirstDay != null
  ? `En esta partida la Tierra asoma hacia el día ${f.earthFirstDay} y se esconde hacia el día ${f.earthLastDay}.`
  : 'En esta partida la Tierra asoma y se esconde según la fecha: búscala en el anillo del horizonte.');
export const TEXTS = {
  pageTitle: 'Varados en el polo · Lunar Landing Site Navigator',
  title: 'Varados en el polo',
  badge: 'Relieve inventado',
  // Relief source of the scenario (J9.2).
  badgeReal: (region) => `Relieve LOLA · ${region}`,
  tutorialLanded: (place) => `Tu tripulación ha aterrizado ${place}. Tendrás que aguantar la noche lunar con energía, agua y oxígeno limitados.`,
  landingPlace: {
    'shackleton-rim': 'en la cresta del cráter Shackleton, junto al polo sur',
    'im2-objetivo': 'cerca de Mons Mouton, donde Athena acabó tumbada en 2025',
  },
  landingPlaceDefault: 'cerca del polo sur de la Luna',
  tutorialBadgeRealTitle: 'Relieve LOLA',
  tutorialBadgeReal: (region) => `El relieve es el de ${region} medido por LOLA, el altímetro láser del Lunar Reconnaissance Orbiter: cráteres, lomas y sombras donde de verdad están.`,
  back: 'Volver a la Luna',
  backHint: 'Volver a la portada',
  langLabel: 'Idioma',
  langEs: 'ES',
  langEn: 'EN',
  motion: 'Reducir movimiento',
  // «Ajustes» in the header (J13.3): quality, light map (J10.4) and reduced motion (J10.2).
  settings: 'Ajustes',
  qualityTitle: 'Calidad del mapa',
  qualityHigh: 'Alta · penumbra',
  qualityLow: 'Baja · sombra dura',
  qualityNoteReload: 'Cambiarla recarga la página y empieza otra partida.',
  qualityNoteLight: 'En modo ligero el mapa va por celdas: la calidad no se aplica.',
  lightMap: 'Modo ligero',
  lightMapDesc: 'Mapa por celdas y sin Luna 3D, para equipos modestos. Al quitarlo se recarga la página y empieza otra partida.',
  motionDesc: 'Sin pulsos ni animaciones; conducir salta al final.',
  stabiliser: 'Estabilizador',
  stabiliserDesc: 'La cámara de la cabina no baila al conducir por el relieve.',
  mapLightOn: 'Modo ligero: el mapa se pinta por celdas, sin WebGL. La partida sigue igual.',
  mapLost: 'El mapa detallado ha fallado y ha pasado al modo ligero. La partida sigue igual.',
  mapLabel: 'Mapa del terreno del polo sur lunar. Usa las flechas para mover el cursor, Intro para planear la ruta más barata hasta esa celda, Intro otra vez para conducir y Escape para cancelar. Pulsa interrogación para oír todos los atajos.',
  mapFallback: 'Tu navegador no puede dibujar el mapa.',
  panelLabel: 'Panel de la partida',
  panelEmpty: 'Aquí irá el panel de la tripulación.',
  loading: 'Cargando el escenario…',
  loadError: 'No se ha podido cargar el escenario. Recarga la página.',
  padLabel: 'ASCENSO',
  hudBattery: 'Batería',
  percent: (v) => `${v} %`,
  hudMinBattery: 'Mínimo para despegar',
  // Battery meter and shadow endurance (J2.2).
  batteryBelowMin: (pct, min) => `${pct} %, por debajo del mínimo para despegar (${min} %)`,
  batteryAboveMin: (pct, min) => `${pct} %, por encima del mínimo para despegar (${min} %)`,
  hudDarkHours: 'Aguante en sombra',
  darkHoursValue: (h) => `~${h} h parado en sombra`,
  // Energy hint (J2.4): replaces hudHint in shadow with a low battery.
  energyShadowLow: 'Estás en sombra y la batería baja: muévete a una zona iluminada o espera al Sol.',
  hudClock: 'Reloj de misión',
  hudDeadline: 'Día límite',
  hudUtc: 'Fecha',
  clock: (day, hour) => `Día ${day} · ${String(hour).padStart(2, '0')}:00`,
  deadline: (day) => `Día ${day}`,
  // State over the map (J13.2): pills, checks, Sun and Earth at the rover, «Leyenda» and the reading line.
  hudBatteryTitle: 'Batería; la marca es el mínimo para despegar',
  hudUtcShort: (ms) => dayMonthTime('es', ms),
  hudDaysLeft: (days) => `−${fmt1(days)} d`,
  checkPackets: (sent, need) => `Paquetes ${sent}/${need}`,
  checkReady: 'Despegue',
  checkDone: 'hecho',
  statLit: 'Al sol · cargando',
  statDark: 'En sombra · calefacción',
  statEarth: 'Tierra visible',
  statNoEarth: 'Tierra tapada',
  legendButton: 'Leyenda',
  readoutRover: 'tu rover está aquí',
  noPath: (deg) => `No hay ruta posible: las pendientes superan ${deg}°`,
  hudHint: 'Toca una celda del mapa para planear: verás la ruta más barata, rodeando las cuestas que no puede subir, y lo que costaría. Pulsa «Conducir» para recorrerla o «Cancelar» para olvidarla. Envía tu informe a la Tierra, cada paquete desde una zona azul distinta (a más de 1 km de las anteriores), y después despega desde ASCENSO con batería suficiente antes del día límite.',
  // Mission goal and packages (J3.1).
  // The goal in pieces (J13.4): strings, and { b } for the figures shown in bold; joined, they are `goal`.
  goalRich: (need, minBat, day) => ['Control de misión necesita tu informe para autorizar el despegue: envíalo a la Tierra en ', { b: `${need} paquetes` }, ', cada uno desde una zona distinta, y llega a ', { b: 'ASCENSO' }, ' con al menos ', { b: `${minBat} %` }, ' de batería antes del ', { b: `día ${day}` }, '.'],
  missionKicker: 'Parte 2 · Atascados',
  goal: (need, minBat, day) => `Control de misión necesita tu informe para autorizar el despegue: envíalo a la Tierra en ${need} paquetes, cada uno desde una zona distinta, y llega a ASCENSO con al menos ${minBat} % de batería antes del día ${day}.`,
  // Packages from different zones (J3.6): each one is the survey of a zone, sent txMinKm away from the others.
  transmitNearSent: (km) => `Ya enviaste desde aquí: busca otra zona azul a más de ${fmt(km)} km.`,
  hintEarthNearSent: (km) => `Desde aquí se ve la Tierra, pero ya enviaste un paquete cerca: busca otra zona azul a más de ${fmt(km)} km.`,
  hudPackets: 'Paquetes',
  packetsValue: (sent, need) => `${sent}/${need}`,
  packetsLabel: (sent, need) => `${sent} de ${need} paquetes enviados`,
  transmit: (hours, extra) => `Transmitir · ${fmt(hours)} h · −${fmt(extra)} %`,
  transmitLabel: 'Hablar con la Tierra',
  liveSent: (sent, need, battery, day, hour) => `Paquete enviado (${sent}/${need}). Batería ${battery} %, día ${day} · ${String(hour).padStart(2, '0')}:00`,
  missingPackets: (k) => `Estás en ASCENSO, pero ${k === 1 ? 'falta 1 paquete' : `faltan ${k} paquetes`} por enviar.`,
  // «Tierra visible» layer (J3.2).
  earthLegend: 'Azul: desde ahí se ve la Tierra ahora.',
  // Map labels and legend (J4.4).
  legendLabel: 'Leyenda del mapa',
  legend: {
    lit: 'Iluminado ahora', shadow: 'En sombra', earth: 'Tierra visible desde ahí', rover: 'Tu rover',
    pad: 'Plataforma de ascenso', route: 'Ruta recorrida', planned: 'Ruta planeada',
    sent: 'Zona ya informada: el siguiente paquete, fuera del círculo',
    earthSoon: 'Verá la Tierra en las próximas 24 h',
  },
  legendSun: (wind, el) => `Sol: al ${wind}, a ${fmt1(el)}°`,
  sunArrow: (el) => `Sol ${fmt1(el)}°`,
  scaleKm: (km) => `${km} km`,
  earthArrow: (el) => `Tierra ${fmt1(el)}°`,
  // Horizon ring (J3.4).
  // 3D Moon (J8.1) and the map / Moon tabs on phones (J8.2).
  moonTitle: 'Dónde estás',
  moonHelp: 'Arrastra para girar · rueda para acercar',
  moonLegSun: 'Sol',
  moonLegEarth: 'Tierra',
  moonLegTrail: 'próximos 4 días',
  moonLegOrbit: 'órbita aparente · no a escala',
  moonLegZone: 'zona de juego (ampliada)',
  moonLegendLabel: 'Leyenda de la Luna 3D',
  // Cabin of the rover (J12.1).
  viewModeLabel: 'Vista del mapa o de la cabina',
  viewMap: 'Mapa',
  viewCabin: 'Cabina',
  transmitShort: 'Transmitir',
  cabinActionsLabel: 'Acciones desde la cabina',
  // Ascent vehicle (J12.8): the crew boards and lifts off to lunar orbit.
  // At the vehicle when the lift-off is not cleared (#398).
  liftoffBlockedPackets: (k) => `La nave está lista, pero control de misión no autoriza el despegue: ${k === 1 ? 'falta 1 paquete' : `faltan ${k} paquetes`}.`,
  liftoffBlockedBattery: (min) => `La nave está lista, pero control de misión no autoriza el despegue: la batería está por debajo del ${min} %.`,
  liftoffDoPackets: 'Envíalos desde zonas azules, cada uno a más de 1 km de los anteriores, y vuelve.',
  liftoffDoPacketsZone: (km, wind, now) => `Envíalos desde zonas azules y vuelve: ${now ? 'la más cercana' : 'la próxima en ver la Tierra'} está a ${fmt(km)} km al ${wind}.`,
  liftoffAlsoBattery: (min) => `Y carga al Sol: la batería está por debajo del ${min} %.`,
  liftoffDoBattery: 'Espera al Sol junto a la nave o carga en una zona iluminada: en cuanto pases del mínimo, despegas.',
  liftoffButton: 'Despegar',
  liftoffReplay: 'Ver el despegue',
  launchBoard: 'La tripulación sube a la nave de ascenso…',
  launchCount: (n) => `Despegue en ${n}…`,
  launchIgnition: '¡Ignición!',
  launchClimb: 'Despegue confirmado: rumbo a la órbita lunar y de vuelta a casa.',
  launchStill: 'Despegue confirmado: la nave de ascenso sale hacia la órbita lunar.',
  // The end card inside the cabin, also in full screen (#398).
  cabinEndWin: '¡Misión cumplida!',
  cabinEndLost: 'Misión fallida',
  cabinEndResult: 'Ver el resultado',
  cabinEndClose: 'Seguir mirando',
  cabinEndLabel: 'Fin de la misión',
  cabinSlope: (deg) => `Demasiada pendiente (máx. ${deg}°)`,
  cabinEdge: 'Fin de la zona de la misión',
  fullscreen: 'Pantalla completa',
  fullscreenExit: 'Salir de pantalla completa',
  cabinZone: (km, now) => `${now ? 'Tierra' : 'Tierra pronto'} · ${fmt1(km)} km`,
  cabinZoneHere: 'Tierra aquí',
  // Why «Transmitir» is off and where the rover heads, from the cabin (J12).
  cabinTxNoEarth: (z) => (!z ? 'Desde aquí no se ve la Tierra.'
    : z.now ? `Desde aquí no se ve la Tierra: ve a una zona azul (${fmt1(Number(z.km))} km al ${z.wind}).`
      : `Desde aquí no se ve la Tierra: pronto se verá desde una zona a ${fmt1(Number(z.km))} km al ${z.wind}.`),
  cabinTxNearSent: (km) => `Ya enviaste cerca: busca otra zona a más de ${fmt(km, 3)} km.`,
  cabinTxAllSent: 'Ya están todos los paquetes enviados.',
  cabinEarthHidden: 'Tapada por el relieve',
  windsAbbr: { N: 'N', NE: 'NE', E: 'E', SE: 'SE', S: 'S', SO: 'SO', O: 'O', NO: 'NO' },
  cabinGuide: 'Línea guía en la cabina',
  cabinGuideDesc: 'Por dónde va el rover y si la cuesta es transitable',
  // Autopilot and accessibility of the cabin (J12.4, J12.6).
  cabinDrive: (km) => `Conducir la ruta · ${fmt1(km)} km · Intro`,
  cabinCancel: 'Cancelar · Esc',
  cabinTakeOver: 'Tomas los mandos',
  cabinSpeed: (kmh, turbo) => `${kmh} km/h${turbo ? ' · marcha larga' : ''}`,
  cabinMinimap: 'Minimapa: flechas para elegir una celda, Intro para planear la ruta y Escape para volver a la cabina.',
  windsShort: { N: 'N', E: 'E', S: 'S', O: 'O' },
  cabinSource: 'Relieve LOLA · el grano, las piedras y los cráteres pequeños del suelo son ilustrativos',
  cabinLoading: 'Bajando al rover…',
  cabinUnavailable: 'La cabina no está disponible en este equipo.',
  // Light and moments of the cabin (J12.5 #301, J12.7 #303).
  cabinEarthRise: (wind) => `La Tierra asoma por el ${wind}: desde aquí ya se ve`,
  cabinShadowLook: 'Toca la brújula o pulsa B para mirar tu sombra',
  cabinShadowBehind: 'Tu sombra cae detrás del rover: gira para verla delante',
  cabinNoShadow: 'Ahora no tienes sombra propia: el rover está en sombra',
  postcard: 'Guardar postal',
  postcardTitle: 'Varados en el polo',
  postcardCaption: ({ day, hour, battery, sent, place }) => `Día ${day} · ${String(hour).padStart(2, '0')}:00 · ${battery} % · ${sent === 1 ? '1 paquete' : `${sent ?? 0} paquetes`} · ${place}`,
  postcardSaved: 'Postal guardada',
  cabinSummary: (sunWind, sunEl, lit, earthWind, earthEl) => `Cabina del rover sobre el relieve real (el grano, las piedras y los cráteres pequeños del suelo son ilustrativos). Sol al ${sunWind}, a ${fmt1(sunEl)}°, ${lit ? 'te da de lleno' : 'tapado por el relieve'}. Tierra al ${earthWind}, a ${fmt1(earthEl)}°${earthEl > 0 ? '' : ', bajo el horizonte'}. Conduce con W, A, S y D o con las flechas, con Mayús para la marcha larga; arrastra para mirar alrededor e Inicio para mirar al frente; B, mirar tu sombra; F, pantalla completa. M lleva al minimapa: elige una celda con las flechas e Intro, y aquí Intro conduce la ruta sola; cualquier tecla de conducir retoma los mandos.`,
  moonUnavailable: 'La vista 3D no está disponible en este equipo.',
  moonSummary: (sunEl, earthEl) => `La Luna en 3D. Desde el polo sur, el Sol está a ${deg(sunEl)} sobre el horizonte y la Tierra a ${deg(earthEl)}.`,
  tabsLabel: 'Vista',
  tabMap: 'Mapa',
  tabMoon: 'Luna 3D',
  ringTitle: 'Anillo del horizonte',
  // Elevation band of the panoramic ring (J13.4), with the true minus sign.
  ringRange: (lo, hi) => `${String(lo).replace('-', '−')}° … ${String(hi).replace('-', '−')}°`,
  // Bearing letters along the bottom of the ring.
  stripWinds: { N: 'N', E: 'E', S: 'S', O: 'O' },
  // What the screen reader hears from the ring: the Sky compass summary of Plan.
  ringSummary: (c) => {
    const one = (name, b) => {
      const g = bearing(b.az);
      const over = b.margin > 0 ? `${fmt1(b.margin)}° sobre el relieve` : `tapado por el relieve (${fmt1(-b.margin)}° por debajo)`;
      return `${name} al ${TEXTS.winds[g.wind]} (${g.text}), a ${fmt1(b.el)}° de altura: ${over}`;
    };
    return `Anillo del horizonte. ${one('Sol', c.sun)}. ${one('Tierra', c.earth)}.`;
  },
  // Winds of bearing(az).wind (web/js/common/sky-polar.js), in words.
  winds: { N: 'norte', NE: 'noreste', E: 'este', SE: 'sureste', S: 'sur', SO: 'suroeste', O: 'oeste', NO: 'noroeste' },
  // Mission hints (J3.5), after the energy one.
  hintAllSent: 'Ya está todo enviado: ve a ASCENSO con batería de sobra.',
  hintEarthHere: 'Desde aquí se ve la Tierra: puedes transmitir.',
  hintEarthLayer: 'Las zonas azules del mapa ven la Tierra ahora mismo: ve a una para transmitir.',
  hintEarthRing: (wind) => `Mira el anillo del horizonte: la Tierra asoma por el ${wind}, rozando el horizonte.`,
  // Where and when the Earth will be in sight (#382): days from earth.bin (earthOutlook), never written by hand.
  hintEarthFew: ({ now, marked, riseDay, manyDay }) => {
    const nowText = now === 0
      ? 'Ahora la Tierra está bajo el horizonte: no se ve desde ningún sitio.'
      : `Ahora la Tierra está muy baja: solo ${now === 1 ? 'la ve 1 sitio' : `la ven ${now} sitios`}${marked ? `, ${now === 1 ? 'marcado' : 'marcados'} con un círculo en el mapa` : ''}.`;
    if (riseDay === null) return `${nowText} No volverá a asomar antes del final de la misión.`;
    const many = manyDay !== null && manyDay !== riseDay ? ` y el día ${manyDay} se verá desde muchas zonas` : manyDay === riseDay ? ', y desde muchas zonas' : '';
    return `${nowText} Empieza a asomar el día ${riseDay}${many}: espera o acércate a las zonas rayadas.`;
  },
  outlookPill: ({ now, riseDay }) => (now === 0 ? 'Tierra bajo el horizonte' : `Tierra: ${now === 1 ? '1 sitio' : `${now} sitios`}`) + (riseDay === null ? '' : ` · asoma el día ${riseDay}`),
  earthSpot: 'Ve la Tierra',
  earthIn: (h) => `la Tierra se verá desde aquí en ${h} h`,
  nextEarthHere: (day, hour) => `Desde aquí se verá el día ${day} a las ${String(hour).padStart(2, '0')}:00.`,
  previewTitle: 'Ruta planeada',
  previewRoute: 'Ruta',
  previewBattery: 'Batería',
  previewRouteValue: (km, hours) => `${fmt(km)} km · ${fmt(hours)} h`,
  previewBatteryValue: (now, end) => `${Math.floor(now)} % → ${Math.floor(end)} %`,
  previewNote: 'Estimación: las sombras se mueven mientras conduces',
  previewDepleted: 'La batería se agota por el camino: el rover se quedaría parado. Puedes conducir igualmente.',
  previewLow: (min) => `Llegarías por debajo del mínimo para despegar (${min} %).`,
  previewTime: 'Se acabaría el tiempo por el camino. Puedes conducir igualmente.',
  drive: 'Conducir',
  // Keys written on the preview buttons (J13.4).
  kbdEnter: 'Intro',
  kbdEsc: 'Esc',
  cancel: 'Cancelar',
  livePreview: (km, hours, battery) => `${fmt(km)} km, ${fmt(hours)} h, llegas con ${Math.floor(battery)} %`,
  livePreviewDepleted: (km, hours) => `${fmt(km)} km, ${fmt(hours)} h, la batería se agota por el camino`,
  liveCancelled: 'Ruta cancelada',
  // Screen-reader announcement of the cursor cell (J10.3): a cellReport (cell-report.js); `rover` when the rover is there.
  dirs: { n: 'norte', ne: 'noreste', e: 'este', se: 'sureste', s: 'sur', so: 'suroeste', o: 'oeste', no: 'noroeste' },
  liveCursor: (r, rover = false) => {
    const parts = [`${rover ? 'Tu rover · ' : ''}Columna ${r.col}, fila ${r.row}`, r.lit ? 'al Sol' : 'en sombra'];
    if (r.earth) parts.push(r.nearSent ? 'Tierra visible, pero ya enviaste cerca' : 'Tierra visible');
    else if (r.earthIn != null) parts.push(TEXTS.earthIn(r.earthIn));
    parts.push(r.padDir ? `ASCENSO a ${fmt1(r.padKm)} km al ${TEXTS.dirs[r.padDir]}` : 'ASCENSO, aquí');
    return parts.join(' · ');
  },
  // Keyboard shortcuts on the map (J10.3): keys in SHORTCUTS of cell-report.js.
  shortcutsHelp: 'Atajos en el mapa: flechas para mover el cursor, Intro para planear y conducir, Escape para cancelar, T para transmitir, 2 y 6 para esperar 2 o 6 horas, S para esperar hasta tener Sol, E para esperar hasta ver la Tierra, L para encender o apagar la capa «Tierra visible» en intermedio, O para ver el objetivo, R para oír el estado de la misión, C para llevar el cursor al rover, P para llevarlo a la plataforma e interrogación para oír esta ayuda.',
  // «R» (J13): the mission status read out.
  liveStatus: (s) => `Batería ${s.battery} % (mínimo ${s.minBat} %). Día ${s.day} · ${String(s.hour).padStart(2, '0')}:00, quedan ${s.hoursLeft} h. Paquetes ${s.sent} de ${s.need}. ${s.lit ? 'Al Sol' : 'En sombra'}${s.earth === null ? '' : s.earth ? ', se ve la Tierra' : ', la Tierra no se ve'}.`,
  shortcutTitle: (key) => `Atajo en el mapa: ${key.replace('Shift', 'Mayús')}`,
  shortcutUnavailable: 'Ahora no se puede.',
  // Wait buttons (J2.1).
  waitLabel: 'Dejar pasar el tiempo',
  wait2: 'Esperar 2 h',
  wait6: 'Esperar 6 h',
  waitSun: 'Hasta tener sol',
  waitEarth: 'Hasta ver la Tierra',
  noEarthSoon: (h) => `Desde aquí no se ve la Tierra en las próximas ${h} h: quizá convenga moverse.`,
  liveWaited: (hours, battery, day, hour) => `Has esperado ${fmt(hours)} h. Batería ${battery} %, día ${day} · ${String(hour).padStart(2, '0')}:00`,
  liveMoved: (battery, day, hour) => `Batería ${battery} %, día ${day} · ${String(hour).padStart(2, '0')}:00`,
  hintDistance: (km) => `${fmt1(km)} km`,
  // dx > 0 means the pad is to the east, dy > 0 to the north (same convention as liveCursor).
  liveStart: (km, dx, dy) => {
    const ns = dy > 0 ? 'nor' : dy < 0 ? 'sur' : '';
    const ew = dx > 0 ? 'este' : dx < 0 ? 'oeste' : '';
    // «norte» and «sur» alone; combined they lose the final vowel: noreste, suroeste.
    const compass = ns && ew ? `${ns}${ew}` : ns ? (dy > 0 ? 'norte' : 'sur') : ew;
    const where = compass ? ` al ${compass}` : '';
    return `La plataforma ASCENSO está a ${fmt1(km)} km${where} en línea recta.`;
  },
  playAgain: 'Jugar otra vez',
  // Ends (J0.4) with the explanation of the game's figures (J7.1): why(summary) gets endSummary of end.js.
  endKicker: 'Fin de la misión',
  end: {
    win: {
      title: 'Despegue confirmado',
      why: (s) => `Llegaste el día ${s.day} · ${String(s.hour).padStart(2, '0')}:00 con ${s.battery} % de batería${s.sent === null ? '' : ` y ${s.sent} ${s.sent === 1 ? 'paquete enviado' : 'paquetes enviados'}`}.${s.sent ? ' Control de misión recibió tu informe y autorizó el despegue.' : ''}`,
    },
    battery: {
      title: 'Sin batería',
      why: (s) => `El rover se quedó sin energía el día ${s.day} · ${String(s.hour).padStart(2, '0')}:00. En sombra, la calefacción vacía la batería aunque no te muevas.`,
    },
    time: {
      title: 'Se acabó el tiempo',
      why: (s) => (s.sent !== null && !s.packetsDone
        ? `Se acabaron los ${s.deadlineDay} días con ${s.sent} de ${s.need} paquetes enviados: sin tu informe completo, control de misión no autorizó el despegue.`
        : `Se acabaron los ${s.deadlineDay} días sin llegar a ASCENSO con al menos ${s.minBat} % de batería.`),
    },
  },
  // Illumination map and lessons of the end (J7.2).
  mapLabelEnd: 'Mapa de iluminación del final: cada sitio va teñido de ámbar según el porcentaje del tiempo que tuvo Sol durante tu misión. La línea blanca es tu ruta.',
  illumSummary: (best, here) => `El sitio más iluminado tuvo Sol el ${best} % del tiempo; donde acabaste, el ${here} %.`,
  illumNote: 'El mapa tiñe de ámbar los sitios según el tiempo que tuvieron sol durante tu misión. La línea blanca es tu ruta.',
  illumLegend: '% del tiempo con sol',
  illumLegendMin: '0 %',
  illumLegendMax: '100 %',
  lessonsTitle: 'Lo que acabas de vivir',
  lessons: [
    { title: 'El Sol rueda rasante.', text: 'Nunca pasa de un par de grados de altura y da la vuelta al horizonte en 29,5 días: las sombras giran y lo que estaba al sol se apaga.' },
    { title: 'El relieve manda.', text: 'A unos cientos de metros conviven zonas con mucha luz y fondos de cráter casi siempre a oscuras. Por eso aterrizar un poco desviado puede acabar una misión.' },
    { title: 'La Tierra roza el horizonte.', text: 'Casi no se mueve en el cielo, pero sube y baja unos grados: para hablar con casa necesitas el sitio y la fecha adecuados.' },
  ],
  // Reference route of the end (J7.3).
  refTitle: 'Así lo resolvió el ordenador',
  refNote: 'La línea discontinua morada es la ruta del ordenador; la blanca, la tuya.',
  refCaption: 'Tu partida frente a la del ordenador',
  refYou: 'Tú',
  refSolver: 'El ordenador',
  refMinBattery: 'Batería mínima',
  refArrival: 'Llegada',
  refNotArrived: 'No llegaste',
  refPct: (v) => `${v} %`,
  // Link to the Mirador (J7.4).
  viewpointLink: 'Explora este sitio en 3D',
  viewpointLinkTitle: (region, day) => `Abre el Mirador del Polo Sur en ${region}, desde el ${day}, en el instante en que acabó la partida`,
  tutorial: 'Tutorial',
  tutorialHint: 'Repetir el tutorial',
  // Tutorial of the first visit. It grows with the screen: one step per element the player has to use.
  // Levels (J6.1).
  levelLabel: 'Nivel',
  levelBeg: 'Principiante',
  levelMid: 'Intermedio',
  levelExp: 'Experto',
  levelNames: { beg: 'Principiante', mid: 'Intermedio', exp: 'Experto' },
  liveLevel: (name) => `Nivel ${name.toLowerCase()}: la misión empieza de nuevo.`,
  hudPanels: 'Paneles',
  panelStatus: { sun: 'Al sol · cargando', partial: 'Sol parcial · carga poco', dark: 'En sombra · calefacción', below: 'Sol rasante: no basta para los paneles' },
  // Mission goal (J6.2).
  goalButton: 'Objetivo',
  goalKicker: (name) => `Tu misión · ${name}`,
  goalTitle: 'Tres pasos para salir de la Luna',
  goalSunTitle: 'Carga al sol',
  goalSunDetail: 'En sombra la batería baja. Que no caiga a 0 %.',
  goalPacketsTitle: (need) => `Envía tu informe a la Tierra en ${need} paquetes`,
  goalPacketsDetail: (km) => `Sin informe, control de misión no autoriza el despegue. Cada paquete es el reconocimiento de una zona: envíalo desde un sitio que vea la Tierra, a más de ${fmt(km)} km de los anteriores. El relieve la tapa desde muchos sitios.`,
  goalPadTitle: (day) => `Llega al despegue antes del día ${day}`,
  goalPadDetail: (min) => `Con al menos ${min} % de batería.`,
  goalGo: '¡Vamos!',
  // Checks (J6.3).
  hudReady: 'Despegue',
  readyYes: 'Listo para despegar',
  readyNo: 'Aún no',
  livePacketsDone: (need) => `Paquetes enviados: ${need} de ${need}.`,
  liveReady: 'Listo para despegar: ve a la plataforma ASCENSO.',
  // Events and log (J6.4).
  logTitle: 'Registro',
  logSpike: (e) => `Pico de consumo: el calefactor se ha disparado (−${e} %).`,
  logAntenna: (h) => `Fallo de antena: durante ${h} h transmitir cuesta el doble de tiempo.`,
  logSent: (n, need) => `Paquete enviado a la Tierra (${n}/${need})`,
  // Help by level (J6.5).
  on: 'encendida',
  off: 'apagada',
  earthToggle: 'Tierra visible',
  tutorialSteps: [
    { target: 'h1', title: 'Varados en el polo',
      // Replaced by tutorialLanded with the place of the scenario (tutorialStepsFor, J9.2).
      text: 'Tu tripulación ha aterrizado cerca del polo sur de la Luna. Tendrás que aguantar la noche lunar con energía, agua y oxígeno limitados.' },
    { target: '#map', title: 'El terreno',
      text: 'El mapa del polo sur donde moverás a tu tripulación. Luz, sombra y la Tierra a la vista deciden cada movimiento. Encima tienes la batería, el reloj, los paquetes y si estás al Sol; debajo, cómo es la celda que señalas.' },
    { target: '#panel', title: 'Tu tripulación',
      text: 'Aquí ves el objetivo, la batería, los paquetes enviados, el reloj de misión y el día límite. Control de misión necesita tu informe para autorizar el despegue: busca una zona azul del mapa, desde donde se ve la Tierra, y pulsa «Transmitir». Cada paquete va desde una zona distinta. Con todos enviados, conduce hasta la plataforma ASCENSO para despegar.' },
    { target: '.levels', title: 'Elige la dificultad',
      text: 'Principiante te enseña desde dónde se ve la Tierra y te da pistas; intermedio te deja encender esa capa; en experto no hay ayudas y los paneles necesitan más de medio Sol. Cambiar de nivel empieza la misión de nuevo.' },
    { target: '.badge', title: 'Relieve inventado',
      text: 'El relieve de esta partida es inventado, para ilustrar. En las partidas con el relieve medido por LOLA, esta etiqueta lo dice.' },
    { target: '.back', title: 'Vuelve a la Luna',
      text: 'Con este enlace regresas a la portada para elegir otra misión.' },
    { target: '#tutorial-btn', title: 'Repite el tutorial cuando quieras',
      text: 'Este botón lo vuelve a lanzar.' },
  ],
  // Buttons of the guided tour (web/js/common/tour-engine.js, option labels).
  tourLabels: {
    next: 'Siguiente', prev: 'Anterior', skip: 'Saltar el tutorial', done: 'Entendido', more: 'Saber más',
    never: 'No mostrar más tutoriales', single: 'Tutorial', count: (i, total) => `Tutorial · paso ${i} de ${total}`,
  },
  // Introduction and trials (J5). Beginner texts of the prototype (INTRO), with the figures from the scenario.
  steps: { landing: 'Aterrizaje', shadows: 'Sombras', power: 'Energía', earth: 'Tierra', play: 'Atascados' },
  stepsLabel: 'Pasos de la misión',
  liveStep: (title, step, n, total) => `${String(title).replace(/\.$/, '')}. Paso ${n} de ${total}: ${step}.`,
  introKicker: 'Parte 1 · Introducción',
  introTitle: 'Te has posado lejos del objetivo',
  // The pad distance comes from the scenario (padDistanceKm); `trials` is how many trials follow.
  introText: (km, trials) => `Tu rover tripulado se posó lejos de la cresta prevista. Está entero, pero aquí casi no llega el Sol. La nave de ascenso te espera en una plataforma a ${fmt1(km)} km, pero no despegará sin permiso: control de misión necesita tu informe del terreno, enviado a la Tierra.${trials > 0 ? ` Antes de jugar, ${['', 'una prueba rápida', 'dos pruebas rápidas', 'tres pruebas rápidas'][trials] ?? `${trials} pruebas rápidas`} para entender las reglas de este sitio.` : ''}`,
  startTrials: 'Empezar las pruebas',
  skipToMission: 'Saltar a la misión',
  startMission: 'Empezar la misión',
  nextTrial: 'Siguiente prueba',
  showMe: 'Enséñamelo',
  replay: 'Repetir animación',
  verdictOk: '¡Bien visto!',
  verdictKo: 'Casi. Mira el mapa.',
  trialKicker: (n, total, name) => `Prueba ${n} de ${total} · ${name}`,
  hoursLater: (h) => `+${Math.round(h)} h`,
  trials: {
    shadows: {
      name: 'Sombras',
      title: 'El Sol no sube: rueda',
      question: 'Pasan 2 días terrestres. ¿Qué harán las sombras del mapa?',
      options: [
        'Se acortan hacia mediodía y se alargan por la tarde, como en la Tierra',
        'Giran alrededor de los relieves, como las agujas de un reloj',
        'No cambian: en el polo la luz es siempre igual',
      ],
      reveal: 'El Sol va dando la vuelta al horizonte casi a la misma altura, así que las sombras no se acortan: giran. Lo que hoy está al sol, en unos días puede quedar a oscuras.',
    },
    power: {
      name: 'Energía',
      title: 'Luz es batería',
      question: 'Tu rover pasa 10 horas en sombra, parado. ¿Qué le pasa a la batería?',
      options: [
        'Nada: si no se mueve, no gasta',
        'Baja: la calefacción y la electrónica siguen consumiendo',
        'Sube un poco con la luz que reflejan las laderas',
      ],
      reveal: 'Baja. En sombra hace muchísimo frío y el rover tiene que calentarse para no romperse. Al sol, los paneles cargan la batería.',
    },
    earth: {
      name: 'Comunicaciones',
      title: 'La Tierra roza el horizonte',
      question: 'Necesitas hablar con la Tierra. ¿Desde dónde la verás mejor?',
      options: [
        'Desde el fondo del cráter, que está más protegido',
        'Desde una zona alta con el horizonte despejado hacia donde está la Tierra',
        'Da igual: la Tierra siempre está en lo alto del cielo',
      ],
      reveal: 'Desde lo alto. Desde el polo, la Tierra casi no se mueve y está pegada al horizonte: cualquier colina en medio la tapa. Las zonas azules del mapa marcan desde dónde se ve ahora.',
    },
  },
  // Figures of each reveal, from the scenario and the engine.
  shadowChange: (toSun, toShadow) => `En 48 h, ${int(toSun)} celdas han pasado a tener Sol y ${int(toShadow)} han pasado a sombra.`,
  powerTenHours: (start, end) => `Con tu rover, 10 h en sombra lo dejan del ${Math.round(start)} % al ${Math.round(end)} %.`,
  miniLabel: (start, sun, dark) => `En 24 h, al Sol la batería pasa de ${Math.round(start)} % a ${Math.round(sun)} %; en sombra, de ${Math.round(start)} % a ${Math.round(dark)} %.`,
  miniSun: (v) => `al sol ${Math.round(v)} %`,
  miniDark: (v) => `en sombra ${Math.round(v)} %`,
  miniStart: '0 h',
  miniEnd: '24 h',
  // Expert texts with the scenario's figures (J9.4, facts of scenario.json). Without facts, a form without figures.
  earthWindow: (f) => earthWindowEs(f),
  // `report` says what the packets are for (#293: goalPacketsDetail with the level's txMinKm).
  introExpert: (facts, trials, report = '') => {
    const f = isFacts(facts) ? facts : null;
    const where = f ? `Desviación en el descenso: el rover acabó en sombra, con un horizonte de hasta ${deg(f.startMaskNorthDeg)} hacia el norte. Nave de ascenso a ${fmt1(f.padKm)} km.`
      : 'Desviación en el descenso: el rover acabó en sombra, con el horizonte alto. La nave de ascenso espera en una plataforma.';
    const lead = report ? `${where} ${report}` : where;
    return trials > 0 ? `${lead} ${['', 'Una prueba', 'Dos pruebas', 'Tres pruebas'][trials] ?? `${trials} pruebas`} para calibrar el modelo antes de operar.` : lead;
  },
  trialsExpert: (facts, lv) => { const f = isFacts(facts) ? facts : null; const level = isFacts(lv) ? lv : { loadDark: 0, charge: 0, panelMin: 0, moveE: 0 }; return {
    shadows: {
      question: f ? `En 48 h el acimut solar avanza ~${deg(f.sunAzPer48hDeg)}. ¿Qué pasa con las sombras?` : 'En 48 h el Sol avanza por el horizonte. ¿Qué pasa con las sombras?',
      reveal: f ? `En esta partida el Sol no pasa de ${deg(f.sunMaxElDeg)} de altura (sin relieve) y su acimut avanza unos ${deg(f.sunAzPer48hDeg / 2)} al día: las sombras miden kilómetros y giran alrededor de los relieves. El disco solar mide 0,53°: al rozar una cresta hay sol parcial.`
        : 'El Sol da la vuelta al horizonte casi a la misma altura: las sombras miden kilómetros y giran alrededor de los relieves. El disco solar mide 0,53°: al rozar una cresta hay sol parcial.',
    },
    power: {
      question: '10 h parado en sombra. ¿Balance energético?',
      reveal: `Balance en sombra: −${fmt(level.loadDark)} %/h (calefacción y aviónica). Al sol: +${fmt(level.charge)} %/h × la fracción del disco visible${level.panelMin > 0 ? `, y solo con al menos el ${fmt(level.panelMin * 100)} % del disco` : ''}. Conducir suma −${fmt(level.moveE)} %/h, y más con pendiente.`,
    },
    earth: {
      question: f ? `Por la libración, en esta partida la Tierra va de ${deg(f.earthElRangeDeg[0])} a ${deg(f.earthElRangeDeg[1])} de altura. ¿Dónde hay enlace directo?`
        : 'La Tierra sube y baja unos grados por la libración. ¿Dónde hay enlace directo?',
      reveal: `Hay enlace directo si la altura de la Tierra menos el horizonte en su dirección supera 0,3°. ${earthWindowEs(f)} Sin capa de ayuda: usa el anillo del horizonte.`,
    },
  }; },
  lessonSun: (f) => `Nunca pasa de ${isFacts(f) ? deg(f.sunMaxElDeg) : 'un par de grados'} de altura y da la vuelta al horizonte en 29,5 días: las sombras giran y lo que estaba al sol se apaga.`,
  earthWindowText: (first, last) => `En esta partida, la Tierra se ve desde algún punto del mapa del día ${first} al día ${last}.`,
  earthBearingText: (wind) => `En este sitio la Tierra está al ${wind}, rozando el horizonte.`,
  earthCellsText: (count, total) => `Desde ${int(count)} de ${int(total)} celdas se ve la Tierra.`,
};

// English with a Spanish fallback per top-level key: a text that a story has not translated yet shows in Spanish
// instead of breaking the game. tests/texts.test.js lists the keys still missing in texts.en.js.
const DICTS = { es: TEXTS, en: { ...TEXTS, ...EN } };

// Dictionary of a language ('es' or 'en'); anything else gives Spanish.
export const texts = (lang) => DICTS[lang] ?? TEXTS;

// Keys of TEXTS that texts.en.js does not translate yet.
export const untranslatedKeys = () => Object.keys(TEXTS).filter((k) => !(k in EN));
