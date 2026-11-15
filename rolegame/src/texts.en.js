// English dictionary of the role-playing game (J10.1). Same keys as TEXTS in texts.js (the Spanish one), and
// for functions the same arguments. A key missing here falls back to Spanish (see texts() in texts.js), so a
// story that adds a Spanish text never breaks the English game; tests/texts.test.js lists what is left.
import { num, deg as degrees } from '../../shared/format/number.js';
import { dayMonthTime } from '../../shared/format/time.js';

// Numbers through shared/format/ (#343): «−» in negatives and thousands grouped also with four digits.
const fmt = (v, max = 1) => num('en', v, max);
const fmt1 = (v) => num('en', v, 1, 1);
const WINDS = { N: 'north', NE: 'northeast', E: 'east', SE: 'southeast', S: 'south', SO: 'southwest', O: 'west', NO: 'northwest' };
const SHORT = { N: 'N', NE: 'NE', E: 'E', SE: 'SE', S: 'S', SO: 'SW', O: 'W', NO: 'NW' };
const compass = (az) => {
  const a = ((Math.round(az) % 360) + 360) % 360;
  return { text: `${String(a).padStart(3, '0')}°`, wind: ['N', 'NE', 'E', 'SE', 'S', 'SO', 'O', 'NO'][Math.round(a / 45) % 8] };
};
const clock = (day, hour) => `day ${day} · ${String(hour).padStart(2, '0')}:00`;

// Degrees with one decimal, for the 3D Moon summary.
const deg = (v) => degrees('en', v, 1, 1);
// Days the Earth shows up and hides in this game (J9.4), from facts of scenario.json.
const isFacts = (f) => f !== null && typeof f === 'object';
const earthWindowEn = (f) => (isFacts(f) && f.earthFirstDay != null
  ? `This game, Earth rises around day ${f.earthFirstDay} and sets around day ${f.earthLastDay}.`
  : 'This game, Earth rises and sets depending on the date: look for it on the horizon ring.');
export const EN = {
  pageTitle: 'Stranded at the Pole · Lunar Landing Site Navigator',
  title: 'Stranded at the Pole',
  badge: 'Made-up terrain',
  // Relief source of the scenario (J9.2).
  badgeReal: (region) => `LOLA terrain · ${region}`,
  tutorialLanded: (place) => `Your crew has landed ${place}. You will have to get through the lunar night with limited power, water and oxygen.`,
  landingPlace: {
    'shackleton-rim': 'on the rim of Shackleton crater, next to the south pole',
    'im2-objetivo': 'near Mons Mouton, where Athena ended up on its side in 2025',
  },
  landingPlaceDefault: 'near the south pole of the Moon',
  tutorialBadgeRealTitle: 'LOLA terrain',
  tutorialBadgeReal: (region) => `The terrain is ${region} as measured by LOLA, the laser altimeter of the Lunar Reconnaissance Orbiter: craters, ridges and shadows where they really are.`,
  back: 'Back to the Moon',
  backHint: 'Back to the home page',
  langLabel: 'Language',
  langEs: 'ES',
  langEn: 'EN',
  motion: 'Reduce motion',
  settings: 'Settings',
  qualityTitle: 'Map quality',
  qualityHigh: 'High · penumbra',
  qualityLow: 'Low · hard shadow',
  qualityNoteReload: 'Changing it reloads the page and starts a new game.',
  qualityNoteLight: 'In light mode the map is drawn by cells: quality does not apply.',
  lightMap: 'Light mode',
  lightMapDesc: 'Map by cells and no 3D Moon, for modest devices. Turning it off reloads the page and starts a new game.',
  motionDesc: 'No pulses or animations; driving jumps to the end.',
  stabiliser: 'Stabiliser',
  stabiliserDesc: 'The cabin camera does not shake while driving over the relief.',
  mapLightOn: 'Light mode: the map is drawn by cells, without WebGL. The game goes on as it was.',
  mapLost: 'The detailed map failed and switched to light mode. The game goes on as it was.',
  mapLabel: 'Terrain map of the lunar south pole. Use the arrow keys to move the cursor, Enter to plan the cheapest route to that cell, Enter again to drive and Escape to cancel. Press question mark to hear every shortcut.',
  mapFallback: 'Your browser cannot draw the map.',
  panelLabel: 'Game panel',
  panelEmpty: 'The crew panel will go here.',
  loading: 'Loading the scenario…',
  loadError: 'The scenario could not be loaded. Reload the page.',
  padLabel: 'ASCENT',
  hudBattery: 'Battery',
  percent: (v) => `${v}%`,
  hudMinBattery: 'Minimum for lift-off',
  batteryBelowMin: (pct, min) => `${pct}%, below the lift-off minimum (${min}%)`,
  batteryAboveMin: (pct, min) => `${pct}%, above the lift-off minimum (${min}%)`,
  hudDarkHours: 'Shadow endurance',
  darkHoursValue: (h) => `~${h} h parked in shadow`,
  energyShadowLow: "You're in shadow and the battery is low: move to a sunlit area or wait for the Sun.",
  hudClock: 'Mission clock',
  hudDeadline: 'Deadline',
  hudUtc: 'Date',
  clock: (day, hour) => `Day ${day} · ${String(hour).padStart(2, '0')}:00`,
  hudBatteryTitle: 'Battery; the mark is the lift-off minimum',
  hudUtcShort: (ms) => dayMonthTime('en', ms),
  hudDaysLeft: (days) => `−${fmt1(days)} d`,
  checkPackets: (sent, need) => `Packets ${sent}/${need}`,
  checkReady: 'Lift-off',
  checkDone: 'done',
  statLit: 'Sunlit · charging',
  statDark: 'In shadow · heating',
  statEarth: 'Earth visible',
  statNoEarth: 'Earth hidden',
  legendButton: 'Legend',
  readoutRover: 'your rover is here',
  deadline: (day) => `Day ${day}`,
  noPath: (deg) => `No route possible: the slopes exceed ${deg}°`,
  hudHint: 'Tap a cell on the map to plan: you will see the cheapest route, going round the slopes the rover cannot climb, and what it would cost. Press «Drive» to follow it or «Cancel» to drop it. Send your report to Earth, each packet from a different blue area (more than 1 km from the previous ones), then lift off from ASCENT with enough battery before the deadline.',
  goalRich: (need, minBat, day) => ['Mission control needs your report to clear the lift-off: send it to Earth in ', { b: `${need} packets` }, ', each from a different zone, and reach ', { b: 'ASCENT' }, ' with at least ', { b: `${minBat}%` }, ' battery before ', { b: `day ${day}` }, '.'],
  missionKicker: 'Part 2 · Stranded',
  goal: (need, minBat, day) => `Mission control needs your report to clear the lift-off: send it to Earth in ${need} packets, each from a different zone, and reach ASCENT with at least ${minBat}% battery before day ${day}.`,
  transmitNearSent: (km) => `You already sent from here: find another blue area more than ${fmt(km)} km away.`,
  hintEarthNearSent: (km) => `Earth is visible from here, but you already sent a packet nearby: find another blue area more than ${fmt(km)} km away.`,
  hudPackets: 'Packets',
  packetsValue: (sent, need) => `${sent}/${need}`,
  packetsLabel: (sent, need) => `${sent} of ${need} packets sent`,
  transmit: (hours, extra) => `Transmit · ${fmt(hours)} h · −${fmt(extra)}%`,
  transmitLabel: 'Talk to Earth',
  liveSent: (sent, need, battery, day, hour) => `Packet sent (${sent}/${need}). Battery ${battery}%, ${clock(day, hour)}`,
  missingPackets: (k) => `You're at ASCENT, but ${k === 1 ? '1 packet is' : `${k} packets are`} still to be sent.`,
  earthLegend: 'Blue: Earth is visible from there right now.',
  legendLabel: 'Map legend',
  legend: {
    lit: 'Sunlit now', shadow: 'In shadow', earth: 'Earth visible from there', rover: 'Your rover',
    pad: 'Ascent pad', route: 'Route driven', planned: 'Planned route',
    sent: 'Zone already surveyed: the next packet, outside the circle',
    earthSoon: 'Will see Earth in the next 24 h',
  },
  legendSun: (wind, el) => `Sun: to the ${wind}, at ${fmt1(el)}°`,
  sunArrow: (el) => `Sun ${fmt1(el)}°`,
  scaleKm: (km) => `${km} km`,
  earthArrow: (el) => `Earth ${fmt1(el)}°`,
  moonTitle: 'Where you are',
  moonHelp: 'Drag to turn · wheel to zoom',
  moonLegSun: 'Sun',
  moonLegEarth: 'Earth',
  moonLegTrail: 'next 4 days',
  moonLegOrbit: 'apparent orbit · not to scale',
  moonLegZone: 'play zone (enlarged)',
  moonLegendLabel: 'Legend of the 3D Moon',
  // Cabin of the rover (J12.1).
  viewModeLabel: 'Map or cabin view',
  viewMap: 'Map',
  viewCabin: 'Cabin',
  transmitShort: 'Transmit',
  cabinActionsLabel: 'Actions from the cabin',
  // Ascent vehicle (J12.8): the crew boards and lifts off to lunar orbit.
  // At the vehicle when the lift-off is not cleared (#398).
  liftoffBlockedPackets: (k) => `The vehicle is ready, but mission control has not cleared the lift-off: ${k === 1 ? '1 packet is' : `${k} packets are`} missing.`,
  liftoffBlockedBattery: (min) => `The vehicle is ready, but mission control has not cleared the lift-off: the battery is below ${min}%.`,
  liftoffDoPackets: 'Send them from blue zones, each more than 1 km from the previous ones, and come back.',
  liftoffDoPacketsZone: (km, wind, now) => `Send them from blue zones and come back: ${now ? 'the nearest' : 'the next one to see the Earth'} is ${fmt(km)} km to the ${wind}.`,
  liftoffAlsoBattery: (min) => `And charge in the Sun: the battery is below ${min}%.`,
  liftoffDoBattery: 'Wait for the Sun by the vehicle or charge in a sunlit area: as soon as you are over the minimum, you lift off.',
  liftoffButton: 'Lift off',
  liftoffReplay: 'Watch the lift-off',
  launchBoard: 'The crew boards the ascent vehicle…',
  launchCount: (n) => `Lift-off in ${n}…`,
  launchIgnition: 'Ignition!',
  launchClimb: 'Lift-off confirmed: heading to lunar orbit and back home.',
  launchStill: 'Lift-off confirmed: the ascent vehicle leaves for lunar orbit.',
  // The end card inside the cabin, also in full screen (#398).
  cabinEndWin: 'Mission accomplished!',
  cabinEndLost: 'Mission failed',
  cabinEndResult: 'See the result',
  cabinEndClose: 'Keep looking',
  cabinEndLabel: 'End of the mission',
  cabinSlope: (deg) => `Too steep (max. ${deg}°)`,
  cabinEdge: 'Edge of the mission area',
  fullscreen: 'Full screen',
  fullscreenExit: 'Exit full screen',
  cabinZone: (km, now) => `${now ? 'Earth' : 'Earth soon'} · ${fmt1(km)} km`,
  cabinZoneHere: 'Earth here',
  // Why «Transmit» is off and where the rover heads, from the cabin (J12).
  cabinTxNoEarth: (z) => (!z ? 'The Earth is not visible from here.'
    : z.now ? `The Earth is not visible from here: go to a blue zone (${fmt1(Number(z.km))} km to the ${z.wind}).`
      : `The Earth is not visible from here: it will soon be visible from a zone ${fmt1(Number(z.km))} km to the ${z.wind}.`),
  cabinTxNearSent: (km) => `You already sent from nearby: find another zone more than ${fmt(km, 3)} km away.`,
  cabinTxAllSent: 'All packets have been sent.',
  cabinEarthHidden: 'Hidden by the relief',
  windsAbbr: { N: 'N', NE: 'NE', E: 'E', SE: 'SE', S: 'S', SO: 'SW', O: 'W', NO: 'NW' },
  cabinGuide: 'Guide line in the cabin',
  cabinGuideDesc: 'Where the rover is going and whether the slope can be driven',
  // Autopilot and accessibility of the cabin (J12.4, J12.6).
  cabinDrive: (km) => `Drive the route · ${fmt1(km)} km · Enter`,
  cabinCancel: 'Cancel · Esc',
  cabinTakeOver: 'You take the controls',
  cabinSpeed: (kmh, turbo) => `${kmh} km/h${turbo ? ' · long gear' : ''}`,
  cabinMinimap: 'Minimap: arrows to pick a cell, Enter to plan the route and Escape to go back to the cabin.',
  windsShort: { N: 'N', E: 'E', S: 'S', O: 'W' },
  cabinSource: 'LOLA terrain · the grain, stones and small craters of the ground are illustrative',
  cabinLoading: 'Climbing down to the rover…',
  cabinUnavailable: 'The cabin is not available on this device.',
  cabinEarthRise: (wind) => `The Earth rises in the ${wind}: you can see it from here now`,
  cabinShadowLook: 'Tap the compass or press B to look at your shadow',
  cabinShadowBehind: 'Your shadow falls behind the rover: turn round to see it ahead',
  cabinNoShadow: 'No shadow of your own right now: the rover is in shadow',
  postcard: 'Save postcard',
  postcardTitle: 'Stranded at the Pole',
  postcardCaption: ({ day, hour, battery, sent, place }) => `Day ${day} · ${String(hour).padStart(2, '0')}:00 · ${battery}% · ${sent === 1 ? '1 packet' : `${sent ?? 0} packets`} · ${place}`,
  postcardSaved: 'Postcard saved',
  cabinSummary: (sunWind, sunEl, lit, earthWind, earthEl) => `Rover cabin over the real relief (the grain, stones and small craters of the ground are illustrative). Sun to the ${sunWind}, ${fmt1(sunEl)}° high, ${lit ? 'shining on you' : 'hidden by the relief'}. Earth to the ${earthWind}, ${fmt1(earthEl)}° high${earthEl > 0 ? '' : ', below the horizon'}. Drive with W, A, S and D or the arrows, with Shift for the long gear; drag to look around and Home to look ahead; B, look at your shadow; F, full screen. M goes to the minimap: pick a cell with the arrows and Enter, and here Enter drives the route by itself; any driving key takes the controls back.`,
  moonUnavailable: '3D view is not available on this device.',
  moonSummary: (sunEl, earthEl) => `The Moon in 3D. From the south pole, the Sun is ${deg(sunEl)} above the horizon and the Earth ${deg(earthEl)}.`,
  tabsLabel: 'View',
  tabMap: 'Map',
  tabMoon: '3D Moon',
  ringTitle: 'Horizon ring',
  ringRange: (lo, hi) => `${String(lo).replace('-', '−')}° … ${String(hi).replace('-', '−')}°`,
  stripWinds: { N: 'N', E: 'E', S: 'S', O: 'W' },
  ringSummary: (c) => {
    const one = (name, b) => {
      const g = compass(b.az);
      const over = b.margin > 0 ? `${fmt1(b.margin)}° above the terrain` : `hidden by the terrain (${fmt1(-b.margin)}° below)`;
      return `${name} to the ${SHORT[g.wind]} (${g.text}), ${fmt1(b.el)}° high: ${over}`;
    };
    return `Horizon ring. ${one('Sun', c.sun)}. ${one('Earth', c.earth)}.`;
  },
  winds: WINDS,
  hintAllSent: "Everything's sent: head to ASCENT with spare battery.",
  hintEarthHere: 'Earth is visible from here: you can transmit.',
  hintEarthLayer: 'The blue areas on the map can see Earth right now: go to one to transmit.',
  hintEarthRing: (wind) => `Check the horizon ring: Earth peeks out to the ${wind}, skimming the horizon.`,
  hintEarthFew: ({ now, marked, riseDay, manyDay }) => {
    const nowText = now === 0
      ? 'Earth is below the horizon right now: it is not visible from anywhere.'
      : `Earth is very low right now: only ${now === 1 ? '1 place sees it' : `${now} places see it`}${marked ? `, marked with a circle on the map` : ''}.`;
    if (riseDay === null) return `${nowText} It will not rise again before the mission ends.`;
    const many = manyDay !== null && manyDay !== riseDay ? ` and on day ${manyDay} it will be visible from many areas` : manyDay === riseDay ? ', visible from many areas' : '';
    return `${nowText} It starts to rise on day ${riseDay}${many}: wait, or move closer to the striped areas.`;
  },
  outlookPill: ({ now, riseDay }) => (now === 0 ? 'Earth below the horizon' : `Earth: ${now === 1 ? '1 place' : `${now} places`}`) + (riseDay === null ? '' : ` · rises on day ${riseDay}`),
  earthSpot: 'Sees Earth',
  earthIn: (h) => `Earth will be visible from here in ${h} h`,
  nextEarthHere: (day, hour) => `From here it will be visible on day ${day} at ${String(hour).padStart(2, '0')}:00.`,
  previewTitle: 'Planned route',
  previewRoute: 'Route',
  previewBattery: 'Battery',
  previewRouteValue: (km, hours) => `${fmt(km)} km · ${fmt(hours)} h`,
  previewBatteryValue: (now, end) => `${Math.floor(now)}% → ${Math.floor(end)}%`,
  previewNote: 'Estimate: shadows move while you drive',
  previewDepleted: 'The battery runs out on the way: the rover would be stranded. You can drive anyway.',
  previewLow: (min) => `You would arrive below the lift-off minimum (${min}%).`,
  previewTime: 'Time would run out on the way. You can drive anyway.',
  drive: 'Drive',
  kbdEnter: 'Enter',
  kbdEsc: 'Esc',
  cancel: 'Cancel',
  livePreview: (km, hours, battery) => `${fmt(km)} km, ${fmt(hours)} h, you arrive with ${Math.floor(battery)}%`,
  livePreviewDepleted: (km, hours) => `${fmt(km)} km, ${fmt(hours)} h, the battery runs out on the way`,
  liveCancelled: 'Route cancelled',
  dirs: { n: 'north', ne: 'northeast', e: 'east', se: 'southeast', s: 'south', so: 'southwest', o: 'west', no: 'northwest' },
  liveCursor: (r, rover = false) => {
    const parts = [`${rover ? 'Your rover · ' : ''}Column ${r.col}, row ${r.row}`, r.lit ? 'sunlit' : 'in shadow'];
    if (r.earth) parts.push(r.nearSent ? 'Earth visible, but you already sent nearby' : 'Earth visible');
    else if (r.earthIn != null) parts.push(EN.earthIn(r.earthIn));
    parts.push(r.padDir ? `ASCENT ${fmt1(r.padKm)} km to the ${EN.dirs[r.padDir]}` : 'ASCENT is here');
    return parts.join(' · ');
  },
  shortcutsHelp: 'Map shortcuts: arrow keys move the cursor, Enter plans and drives, Escape cancels, T transmits, 2 and 6 wait 2 or 6 hours, S waits until sunlit, E waits until Earth is visible, L switches the «Earth visible» layer in intermediate, O shows the goal, R reads out the mission status, C moves the cursor to the rover, P moves it to the pad and question mark repeats this help.',
  liveStatus: (s) => `Battery ${s.battery}% (minimum ${s.minBat}%). Day ${s.day} · ${String(s.hour).padStart(2, '0')}:00, ${s.hoursLeft} h left. Packets ${s.sent} of ${s.need}. ${s.lit ? 'Sunlit' : 'In shadow'}${s.earth === null ? '' : s.earth ? ', Earth is visible' : ', Earth is not visible'}.`,
  shortcutTitle: (key) => `Map shortcut: ${key}`,
  shortcutUnavailable: 'Not possible right now.',
  waitLabel: 'Let time pass',
  wait2: 'Wait 2 h',
  wait6: 'Wait 6 h',
  waitSun: 'Until sunlit',
  waitEarth: 'Until Earth is visible',
  noEarthSoon: (h) => `Earth will not be visible from here in the next ${h} h: it may be worth moving.`,
  liveWaited: (hours, battery, day, hour) => `You waited ${fmt(hours)} h. Battery ${battery}%, ${clock(day, hour)}`,
  liveMoved: (battery, day, hour) => `Battery ${battery}%, ${clock(day, hour)}`,
  hintDistance: (km) => `${fmt1(km)} km`,
  liveStart: (km, dx, dy) => {
    const ns = dy > 0 ? 'north' : dy < 0 ? 'south' : '';
    const ew = dx > 0 ? 'east' : dx < 0 ? 'west' : '';
    const compass = `${ns}${ew}`;
    const where = compass ? ` to the ${compass}` : '';
    return `The ASCENT pad is ${fmt1(km)} km${where} in a straight line.`;
  },
  playAgain: 'Play again',
  endKicker: 'End of the mission',
  end: {
    win: {
      title: 'Lift-off confirmed',
      why: (s) => `You arrived on ${clock(s.day, s.hour)} with ${s.battery}% battery${s.sent === null ? '' : ` and ${s.sent} ${s.sent === 1 ? 'packet' : 'packets'} sent`}.${s.sent ? ' Mission control got your report and cleared the lift-off.' : ''}`,
    },
    battery: {
      title: 'Out of battery',
      why: (s) => `The rover ran out of power on ${clock(s.day, s.hour)}. In shadow, the heaters drain the battery even if you stay still.`,
    },
    time: {
      title: 'Out of time',
      why: (s) => (s.sent !== null && !s.packetsDone
        ? `The ${s.deadlineDay} days ran out with ${s.sent} of ${s.need} packets sent: without your full report, mission control did not clear the lift-off.`
        : `The ${s.deadlineDay} days ran out before you reached ASCENT with at least ${s.minBat}% battery.`),
    },
  },
  mapLabelEnd: 'Illumination map of the end: each place is tinted amber by the share of time it had Sun during your mission. The white line is your route.',
  illumSummary: (best, here) => `The sunniest place had Sun ${best}% of the time; where you ended, ${here}%.`,
  illumNote: 'The map tints places amber by how long they had sun during your mission. The white line is your route.',
  illumLegend: '% of the time in sunlight',
  illumLegendMin: '0%',
  illumLegendMax: '100%',
  lessonsTitle: 'What you just lived through',
  lessons: [
    { title: 'The Sun rolls low.', text: 'It never climbs above a couple of degrees and goes round the horizon in 29.5 days: shadows turn and what was sunlit goes dark.' },
    { title: 'Relief rules.', text: 'A few hundred metres apart, very sunny spots sit next to crater floors that are almost always dark. That is why landing slightly off target can end a mission.' },
    { title: 'Earth skims the horizon.', text: 'It barely moves across the sky, but it rises and sinks a few degrees: to talk to home you need the right place and the right date.' },
  ],
  refTitle: 'How the computer solved it',
  refNote: 'The dashed purple line is the computer\'s route; the white one is yours.',
  refCaption: 'Your game against the computer\'s',
  refYou: 'You',
  refSolver: 'The computer',
  refMinBattery: 'Lowest battery',
  refArrival: 'Arrival',
  refNotArrived: 'You did not arrive',
  refPct: (v) => `${v}%`,
  viewpointLink: 'Explore this site in 3D',
  viewpointLinkTitle: (region, day) => `Opens the South Pole Viewpoint at ${region}, from ${day}, at the moment the game ended`,
  tutorial: 'Tour',
  tutorialHint: 'Replay the tour',
  // Levels (J6.1).
  levelLabel: 'Level',
  levelBeg: 'Beginner',
  levelMid: 'Intermediate',
  levelExp: 'Expert',
  levelNames: { beg: 'Beginner', mid: 'Intermediate', exp: 'Expert' },
  liveLevel: (name) => `${name} level: the mission starts again.`,
  hudPanels: 'Panels',
  panelStatus: { sun: 'In sunlight · charging', partial: 'Partial sun · weak charge', dark: 'In shadow · heating', below: 'Grazing sun: not enough for the panels' },
  // Mission goal (J6.2).
  goalButton: 'Goal',
  goalKicker: (name) => `Your mission · ${name}`,
  goalTitle: 'Three steps to get off the Moon',
  goalSunTitle: 'Charge in sunlight',
  goalSunDetail: "Shadow drains the battery. Don't let it hit 0%.",
  goalPacketsTitle: (need) => `Send your report to Earth in ${need} packets`,
  goalPacketsDetail: (km) => `Without the report, mission control will not clear the lift-off. Each packet is the survey of a zone: send it from a place that sees Earth, more than ${fmt(km)} km from the previous ones. The terrain hides it from many places.`,
  goalPadTitle: (day) => `Reach the launch pad before day ${day}`,
  goalPadDetail: (min) => `With at least ${min}% battery.`,
  goalGo: "Let's go!",
  // Checks (J6.3).
  hudReady: 'Lift-off',
  readyYes: 'Ready to lift off',
  readyNo: 'Not yet',
  livePacketsDone: (need) => `Packets sent: ${need} of ${need}.`,
  liveReady: 'Ready to lift off: go to the ASCENT pad.',
  // Events and log (J6.4).
  logTitle: 'Log',
  logSpike: (e) => `Power spike: the heater kicked in hard (−${e}%).`,
  logAntenna: (h) => `Antenna fault: for ${h} h, transmitting takes twice as long.`,
  logSent: (n, need) => `Packet sent to Earth (${n}/${need})`,
  // Help by level (J6.5).
  on: 'on',
  off: 'off',
  earthToggle: 'Earth visible',
  tutorialSteps: [
    { target: 'h1', title: 'Stranded at the Pole',
      // Replaced by tutorialLanded with the place of the scenario (tutorialStepsFor, J9.2).
      text: 'Your crew has landed near the south pole of the Moon. You will have to get through the lunar night with limited power, water and oxygen.' },
    { target: '#map', title: 'The terrain',
      text: 'The south pole map where you will move your crew. Light, shadow and having Earth in sight decide every move. On top you have the battery, the clock, the packets and whether you are in sunlight; below, what the cell you point at is like.' },
    { target: '#panel', title: 'Your crew',
      text: 'Here you see the goal, the battery, the packets sent, the mission clock and the deadline. Mission control needs your report to clear the lift-off: find a blue area on the map, from where Earth is visible, and press «Transmit». Each packet goes from a different zone. With all of them sent, drive to the ASCENT pad to lift off.' },
    { target: '.levels', title: 'Choose the difficulty',
      text: 'Beginner shows where Earth is visible from and gives you hints; intermediate lets you switch that layer on; expert has no help and the panels need more than half the Sun. Changing level starts the mission again.' },
    { target: '.badge', title: 'Made-up terrain',
      text: 'The terrain of this game is made up, to illustrate. In the games with the terrain measured by LOLA, this label says so.' },
    { target: '.back', title: 'Back to the Moon',
      text: 'This link takes you back to the home page to choose another mission.' },
    { target: '#tutorial-btn', title: 'Replay the tour whenever you like',
      text: 'This button starts it again.' },
  ],
  // Buttons of the guided tour (web/js/common/tour-engine.js, option labels).
  tourLabels: {
    next: 'Next', prev: 'Back', skip: 'Skip the tour', done: 'Got it', more: 'Learn more',
    never: "Don't show tours again", single: 'Tour', count: (i, total) => `Tour · step ${i} of ${total}`,
  },
  // Introduction and trials (J5).
  steps: { landing: 'Landing', shadows: 'Shadows', power: 'Power', earth: 'Earth', play: 'Stranded' },
  stepsLabel: 'Mission steps',
  liveStep: (title, step, n, total) => `${String(title).replace(/\.$/, '')}. Step ${n} of ${total}: ${step}.`,
  introKicker: 'Part 1 · Introduction',
  introTitle: 'You landed off target',
  introText: (km, trials) => `Your crewed rover came down far from the planned ridge. It is intact, but sunlight barely reaches here. The ascent vehicle waits on a pad ${fmt1(km)} km away, but it will not lift off without clearance: mission control needs your survey of the terrain, sent to Earth.${trials > 0 ? ` Before you play, ${['', 'one quick test', 'two quick tests', 'three quick tests'][trials] ?? `${trials} quick tests`} to learn this place's rules.` : ''}`,
  startTrials: 'Start the tests',
  skipToMission: 'Skip to the mission',
  startMission: 'Start the mission',
  nextTrial: 'Next test',
  showMe: 'Show me',
  replay: 'Replay animation',
  verdictOk: 'Well spotted!',
  verdictKo: 'Not quite. Look at the map.',
  trialKicker: (n, total, name) => `Test ${n} of ${total} · ${name}`,
  hoursLater: (h) => `+${Math.round(h)} h later`,
  trials: {
    shadows: {
      name: 'Shadows',
      title: "The Sun doesn't rise: it rolls",
      question: 'Two Earth days go by. What will the shadows on the map do?',
      options: [
        'They shorten towards noon and stretch in the afternoon, like on Earth',
        'They swing around the terrain, like clock hands',
        "They don't change: light at the pole is always the same",
      ],
      reveal: "The Sun circles the horizon at almost the same height, so shadows don't shorten: they swing round. What's sunlit today may be dark in a few days.",
    },
    power: {
      name: 'Power',
      title: 'Light is battery',
      question: 'Your rover sits 10 hours in shadow. What happens to the battery?',
      options: [
        "Nothing: if it doesn't move, it doesn't use power",
        'Drops: heaters and electronics keep drawing power',
        'Rises a bit from light reflected by the slopes',
      ],
      reveal: 'It drops. Shadow is bitterly cold and the rover must heat itself to survive. In sunlight, the panels charge the battery.',
    },
    earth: {
      name: 'Communications',
      title: 'Earth skims the horizon',
      question: 'You need to talk to Earth. Where will you see it best?',
      options: [
        "From the crater floor, it's more sheltered",
        'From high ground with a clear horizon towards where Earth is',
        "Doesn't matter: Earth is always high in the sky",
      ],
      reveal: 'From high ground. From the pole, Earth barely moves and sits right on the horizon: any hill in between hides it. Blue areas on the map show where it is visible now.',
    },
  },
  shadowChange: (toSun, toShadow) => `In 48 h, ${fmt(toSun, 3)} cells have come into sunlight and ${fmt(toShadow, 3)} have gone into shadow.`,
  powerTenHours: (start, end) => `With your rover, 10 h in shadow take it from ${Math.round(start)}% to ${Math.round(end)}%.`,
  miniLabel: (start, sun, dark) => `In 24 h, in sunlight the battery goes from ${Math.round(start)}% to ${Math.round(sun)}%; in shadow, from ${Math.round(start)}% to ${Math.round(dark)}%.`,
  miniSun: (v) => `sunlit ${Math.round(v)}%`,
  miniDark: (v) => `in shadow ${Math.round(v)}%`,
  miniStart: '0 h',
  miniEnd: '24 h',
  // Expert texts with the scenario's figures (J9.4).
  earthWindow: (f) => earthWindowEn(f),
  // `report` says what the packets are for (#293: goalPacketsDetail with the level's txMinKm).
  introExpert: (facts, trials, report = '') => {
    const f = isFacts(facts) ? facts : null;
    const where = f ? `Descent dispersion: the rover ended up in shadow, with a horizon up to ${deg(f.startMaskNorthDeg)} to the north. Ascent vehicle ${fmt1(f.padKm)} km away.`
      : 'Descent dispersion: the rover ended up in shadow, with a high horizon. The ascent vehicle waits on a pad.';
    const lead = report ? `${where} ${report}` : where;
    return trials > 0 ? `${lead} ${['', 'One test', 'Two tests', 'Three tests'][trials] ?? `${trials} tests`} to calibrate the model before operating.` : lead;
  },
  trialsExpert: (facts, lv) => { const f = isFacts(facts) ? facts : null; const level = isFacts(lv) ? lv : { loadDark: 0, charge: 0, panelMin: 0, moveE: 0 }; return {
    shadows: {
      question: f ? `In 48 h solar azimuth advances ~${deg(f.sunAzPer48hDeg)}. What happens to the shadows?` : 'In 48 h the Sun moves along the horizon. What happens to the shadows?',
      reveal: f ? `This game the Sun never gets above ${deg(f.sunMaxElDeg)} (without terrain) and its azimuth advances about ${deg(f.sunAzPer48hDeg / 2)} a day: shadows are kilometres long and swing around the terrain. The solar disc spans 0.53°: grazing a ridge gives partial sun.`
        : 'The Sun circles the horizon at almost the same height: shadows are kilometres long and swing around the terrain. The solar disc spans 0.53°: grazing a ridge gives partial sun.',
    },
    power: {
      question: '10 h parked in shadow. Energy balance?',
      reveal: `Shadow balance: −${fmt(level.loadDark)}%/h (heating and avionics). Sunlit: +${fmt(level.charge)}%/h × visible disc fraction${level.panelMin > 0 ? `, only with at least ${fmt(level.panelMin * 100)}% of the disc` : ''}. Driving adds −${fmt(level.moveE)}%/h, more on slopes.`,
    },
    earth: {
      question: f ? `Libration takes Earth from ${deg(f.earthElRangeDeg[0])} to ${deg(f.earthElRangeDeg[1])} of elevation this game. Where is there a direct link?`
        : 'Earth rises and sinks a few degrees with libration. Where is there a direct link?',
      reveal: `Direct link if Earth's elevation minus the horizon in its direction is over 0.3°. ${earthWindowEn(f)} No helper layer: use the horizon ring.`,
    },
  }; },
  lessonSun: (f) => `It never climbs above ${isFacts(f) ? deg(f.sunMaxElDeg) : 'a couple of degrees'} and goes round the horizon in 29.5 days: shadows turn and what was sunlit goes dark.`,
  earthWindowText: (first, last) => `This game, Earth is visible from somewhere on the map from day ${first} to day ${last}.`,
  earthBearingText: (wind) => `At this site Earth is to the ${wind}, skimming the horizon.`,
  earthCellsText: (count, total) => `Earth is visible from ${fmt(count, 3)} of ${fmt(total, 3)} cells.`,
};
