// Every text the player reads, in one place. TEXTS is the Spanish dictionary; the English one is in texts.en.js.
// texts(lang) gives the one of a language; UI and LANG are the ones in use, set once by useLang() when the page starts.
import { EN } from './texts.en.js';
import { num } from '../../shared/format/number.js';

export const TEXTS = {
  pageTitle: 'Aterrizaje a bordo · Lunar Landing Site Navigator',
  title: 'Aterrizaje a bordo',
  canvasLabel: 'Cabina del módulo de aterrizaje',
  back: '← Volver a la Luna',
  loading: 'Preparando la cabina…',
  loadingSteps: ['Levantando el relieve del polo sur…', 'Cableando los paneles…', 'Sentando a la tripulación…'],
  noWebgl: 'Este equipo no puede dibujar la cabina en 3D.',
  intro: {
    kicker: 'Misión 04 · Borde de Cabeus B · 82,3° S 54,5° O',
    heading: 'Aterriza en el polo sur desde la cabina',
    text: 'Eres la comandante del módulo de aterrizaje. Quedan 4,6 km hasta el sitio y 2.100 m de altura. El piloto automático sabe posarse solo: mira, toca lo que quieras y, si te atreves, toma el mando.',
    controlsTitle: 'Controles',
    controls: [
      ['Ratón', 'mirar (clic para capturar el cursor, Esc para soltarlo)'],
      ['Clic', 'accionar el control al que apuntas'],
      ['E', 'levantarte del asiento o sentarte'],
      ['W A S D', 'caminar por la cabina'],
      ['M', 'piloto automático o manual'],
      ['↑ ↓', 'empuje del motor (en manual)'],
      ['← →', 'inclinar la nave (en manual)'],
      ['G', 'tren de aterrizaje'],
    ],
    touchControls: [
      ['Arrastrar', 'mirar'],
      ['Tocar', 'accionar un control'],
      ['Palanca', 'caminar por la cabina'],
      ['Botones', 'empuje, inclinación y asiento'],
    ],
    start: 'Empezar el descenso',
    soundNote: 'Con sonido: motor, alarmas y radio.',
  },
  phases: { approach: 'Aproximación', braking: 'Frenado', final: 'Descenso final', contact: 'Contacto', abort: 'Aborto' },
  hud: { alt: 'Altura', vv: 'Vel. vertical', vh: 'Vel. horizontal', fuel: 'Combustible', thrust: 'Empuje', auto: 'AUTO', manual: 'MANUAL', lockHint: 'Clic para mirar con el ratón', paused: 'En pausa' },
  touch: { sit: 'Sentarse', stand: 'Levantarse', auto: 'Auto', up: 'Más empuje', down: 'Menos empuje', tiltBack: 'Frenar', tiltFwd: 'Avanzar' },
  controlHint: { on: 'encendido', off: 'apagado', coverOpen: 'tapa abierta: pulsa otra vez', coverOpenOn: 'tapa abierta: pulsa para desactivarlo', coverOpenLatched: 'tapa abierta · no se puede deshacer', coverClosed: 'con tapa: pulsa para abrirla', lever: 'clic o rueda del ratón', stick: 'usa ← y → en manual' },
  hints: {
    coverOpen: 'Tapa de seguridad abierta. Pulsa otra vez para accionarlo.',
    stick: 'El mando de actitud se mueve con ← y → cuando vuelas en manual.',
    needsGnc: 'Sin el ordenador GNC no hay piloto automático.',
    autopilotLost: 'Piloto automático desconectado: tienes el mando.',
    manual: 'Mando manual. Empuje con ↑ ↓ e inclinación con ← →.',
    manualTouch: 'Mando manual. Empuje con ▲ ▼ e inclinación con ◀ ▶.',
    auto: 'Piloto automático conectado.',
    sit: 'Pulsa E para sentarte',
    stand: 'Pulsa E para levantarte',
    hatch: 'La esclusa no se abre con la cabina presurizada. Y menos a esta altura.',
    seatTaken: 'Ese asiento ya tiene dueño.',
    window: 'El suelo del polo sur, a través del cristal.',
  },
  props: { can: 'Lata de 540 Energy Drink · Pistacho', seat: 'Tu asiento', hatch: 'Esclusa', pilot: 'Piloto', specialist1: 'Especialista de misión', specialist2: 'Especialista de misión' },
  can: [
    'Pistacho. Bien fría, como el fondo de Cabeus: allí no sube de −200 °C.',
    'Cafeína para el descenso. El empuje lo pone el motor.',
    'Sujeta con velcro: en caída libre el pistacho no perdona.',
    'Reservada para después del contacto. Órdenes de la comandante.',
    'Control de misión pregunta si queda otra lata. No queda.',
  ],
  crew: {
    pilot: ['Todo en verde por mi lado.', 'Tú mira por la ventana, que yo vigilo el combustible.', 'Si tocas ese interruptor, avisa antes.'],
    specialist1: ['Tengo el mapa de sombras abierto. El sitio está al Sol.', 'La Tierra se ve preciosa por la izquierda.'],
    specialist2: ['Cinturón apretado. Cuando quieras.', 'Yo no he tocado nada. Lo juro.'],
  },
  radio: {
    armed: 'Piloto: motor de descenso armado.',
    ignition: 'Piloto: ignición. Empieza el frenado.',
    gear: 'Piloto: tren de aterrizaje abajo.',
    final: 'Piloto: sobre el sitio. Descenso final.',
    height: (h, vz) => `Piloto: ${h} metros, bajando a ${num('es', Math.abs(vz), 1, 1)}.`,
    contact: 'Piloto: ¡luz de contacto! Motor parado.',
    crash: 'Piloto: ¡impacto! ¡Agarraos!',
    abort: 'Piloto: ¡aborto! Subimos.',
  },
  warnings: { lowFuel: 'Combustible bajo', sinkRate: 'Bajas demasiado rápido', gearUp: 'Tren sin desplegar', noEngine: 'Motor sin armar o sin propelente', noRcs: 'RCS apagado: no puedes girar la nave' },
  end: {
    soft: { title: 'Aterrizaje correcto', text: 'La nave está entera y vertical sobre el borde de Cabeus B. Bienvenida al polo sur.' },
    hard: { title: 'Aterrizaje duro', text: 'Estáis vivos, pero la nave ha sufrido daños. Habrá que revisarla antes de despegar.' },
    crash: { title: 'Aterrizaje fallido', text: 'La nave no ha aguantado el contacto.' },
    abort: { title: 'Descenso abortado', text: 'El motor de ascenso os devuelve a la órbita. La Luna seguirá ahí mañana.' },
    lost: { title: 'Fuera de la trayectoria', text: 'Os habéis alejado tanto del sitio que ya no queda combustible para volver.' },
    reasons: { vertical: 'Velocidad vertical demasiado alta', horizontal: 'Velocidad horizontal demasiado alta', tilt: 'Nave demasiado inclinada', gear: 'Tren de aterrizaje sin desplegar' },
    rows: { vertical: 'Velocidad vertical', horizontal: 'Velocidad horizontal', tilt: 'Inclinación', distance: 'Distancia al objetivo', fuel: 'Combustible restante', time: 'Tiempo de descenso', score: 'Puntuación' },
    limits: 'Límite del tren (Apollo LM): 3 m/s en vertical, 1,2 m/s en horizontal y 6° de inclinación.',
    retry: 'Repetir el descenso',
    home: 'Volver a la Luna',
  },
  // Labels engraved on the panels, the cabin signs and the screens: the Spanish text is the key (texts.en.js maps it).
  cockpit: text => text,
};

const DICTS = { es: TEXTS, en: { ...TEXTS, ...EN } };

/** Dictionary of a language ('es' or 'en'); anything else gives Spanish. A key missing in English falls back to Spanish. */
export const texts = lang => DICTS[lang] ?? TEXTS;

/** Keys of TEXTS that texts.en.js does not translate yet. */
export const untranslatedKeys = () => Object.keys(TEXTS).filter(k => !(k in EN));

export let UI = TEXTS;
export let LANG = 'es';
export function useLang(lang) {
  LANG = lang in DICTS ? lang : 'es';
  UI = texts(LANG);
}

/** A figure with fixed decimals in the language in use (shared/format/, #343): «2.100,5», «−3,2». */
export const formatNumber = (value, digits = 0, lang = LANG) => num(lang, value, digits, digits);
/**
 * A figure for the cockpit screens: the same rules as formatNumber but without thousands grouping, because the engraved
 * panels have fixed-width cells («2100», not «2.100», keeps 4 characters).
 */
export const fixed = (value, digits = 0, lang = LANG) => num(lang, value, digits, digits, { grouping: false });
