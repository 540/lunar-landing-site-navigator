// Control con las manos (shared/hands/): las reglas del gesto (gesture.js), sin cámara ni MediaPipe.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createHandTracker, createHandsTracker, fingerReach, isSalute, palmCentre, pinchRatio, pointerToScreen, thumbGap } from '../shared/hands/gesture.js';

const SIZE = 0.2; // de la muñeca a la base del dedo medio
/**
 * Mano sintética con la palma en (cx, cy), los dedos hacia arriba de la imagen.
 * `pose`: 'open' (todo estirado), 'point' (índice estirado y el resto doblado), 'pinch' (yemas de pulgar e índice juntas,
 * el resto estirado), 'fist' (todo doblado). `thumb` ('out' o 'in') solo cuenta en 'point' y 'open'.
 */
function hand(cx, cy, pose = 'open', thumb = 'out') {
  const up = cy - SIZE / 2, lm = Array.from({ length: 21 }, () => ({ x: cx, y: cy }));
  lm[0] = { x: cx, y: cy + SIZE / 2 };
  [[5, -0.03], [9, 0], [13, 0.03], [17, 0]].forEach(([i, dx]) => { lm[i] = { x: cx + dx, y: up }; });
  const others = pose === 'open' || pose === 'pinch' ? cy - 0.3 : cy;
  [[12, 0], [16, 0.03], [20, 0.05]].forEach(([i, dx]) => { lm[i] = { x: cx + dx, y: others }; });
  lm[6] = { x: cx - 0.03, y: up - 0.07 };
  lm[8] = { x: cx - 0.03, y: pose === 'fist' ? cy : cy - 0.3 };
  lm[4] = thumb === 'in' ? { x: cx - 0.05, y: up - 0.02 } : { x: cx - 0.2, y: cy };
  if (pose === 'pinch') { lm[4] = { x: cx - 0.04, y: cy - 0.22 }; lm[8] = { x: cx - 0.02, y: cy - 0.22 }; }
  return lm;
}
const near = (a, b) => assert.ok(Math.abs(a - b) < 1e-9, `${a} ≠ ${b}`);

test('las medidas de la mano sintética: pinza, dedos y pulgar', () => {
  near(pinchRatio(hand(0.5, 0.5, 'pinch')), 0.1);
  assert.ok(pinchRatio(hand(0.5, 0.5, 'point')) > 0.6);
  assert.ok(pinchRatio(hand(0.5, 0.5, 'point', 'in')) > 0.6, 'doblar el pulgar no es una pinza');
  assert.ok(fingerReach(hand(0.5, 0.5, 'open')).every(r => r > 1.5));
  assert.ok(fingerReach(hand(0.5, 0.5, 'fist')).every(r => r < 1.35));
  const [index, ...others] = fingerReach(hand(0.5, 0.5, 'point'));
  assert.ok(index > 1.5 && others.every(r => r < 1.35));
  assert.ok(thumbGap(hand(0.5, 0.5, 'point')) > 0.6);
  assert.ok(thumbGap(hand(0.5, 0.5, 'point', 'in')) < 0.42);
});

test('las medidas no dependen de lo lejos que esté la mano', () => {
  const far = lm => lm.map(p => ({ x: p.x / 2, y: p.y / 2 }));
  near(pinchRatio(far(hand(0.5, 0.5, 'pinch'))), 0.1);
  near(thumbGap(far(hand(0.5, 0.5, 'point', 'in'))), thumbGap(hand(0.5, 0.5, 'point', 'in')));
});

test('sin mano no hay nada', () => {
  assert.deepEqual(createHandTracker().update(null), { present: false, grabbing: false, pointing: false, pressed: false, x: 0, y: 0, px: 0, py: 0, dx: 0, dy: 0, click: false, salute: false });
});

test('solo el índice estirado apunta, con el puntero en su yema y en espejo', () => {
  const t = createHandTracker({ smoothing: 1 });
  const s = t.update(hand(0.3, 0.6, 'point'));
  assert.equal(s.pointing, true);
  near(s.px, 1 - 0.27);
  near(s.py, 0.3);
  assert.equal(createHandTracker().update(hand(0.5, 0.5, 'open')).pointing, false, 'la mano abierta no apunta');
  assert.equal(createHandTracker().update(hand(0.5, 0.5, 'fist')).pointing, false, 'el puño no apunta');
  assert.equal(createHandTracker().update(hand(0.5, 0.5, 'pinch')).pointing, false, 'la pinza no apunta');
});

test('apuntando, doblar el pulgar es un clic: uno solo hasta volver a sacarlo', () => {
  const t = createHandTracker();
  assert.equal(t.update(hand(0.5, 0.5, 'point')).click, false);
  const down = t.update(hand(0.5, 0.5, 'point', 'in'));
  assert.deepEqual([down.pointing, down.pressed, down.click], [true, true, true]);
  assert.equal(t.update(hand(0.5, 0.5, 'point', 'in')).click, false, 'el pulgar doblado no repite');
  assert.equal(t.update(hand(0.5, 0.5, 'point')).pressed, false);
  assert.equal(t.update(hand(0.5, 0.5, 'point', 'in')).click, true);
});

test('no hay clic si se empieza a apuntar con el pulgar ya doblado, ni sin apuntar', () => {
  const t = createHandTracker();
  const s = t.update(hand(0.5, 0.5, 'point', 'in'));
  assert.deepEqual([s.pressed, s.click], [true, false]);
  const open = createHandTracker();
  open.update(hand(0.5, 0.5, 'open'));
  const folded = open.update(hand(0.5, 0.5, 'open', 'in'));
  assert.deepEqual([folded.pointing, folded.pressed, folded.click], [false, false, false]);
  // Dejar de apuntar desarma el clic: al volver con el pulgar doblado no pulsa.
  const again = createHandTracker();
  again.update(hand(0.5, 0.5, 'point'));
  again.update(hand(0.5, 0.5, 'open'));
  assert.equal(again.update(hand(0.5, 0.5, 'point', 'in')).click, false);
});

test('la pinza agarra: el primer fotograma no mueve y los siguientes sí, en espejo', () => {
  const t = createHandTracker({ smoothing: 1 });
  t.update(hand(0.5, 0.5, 'open'));
  const first = t.update(hand(0.5, 0.5, 'pinch'));
  assert.deepEqual([first.grabbing, first.dx, first.click], [true, 0, false]);
  // La mano va a la izquierda de la imagen, que es la derecha del usuario: dx positivo. Y baja: dy positivo.
  const s = t.update(hand(0.4, 0.6, 'pinch'));
  near(s.dx, 0.1);
  near(s.dy, 0.1);
  near(s.x, 0.6);
});

test('la mano abierta o apuntando no arrastra', () => {
  for (const pose of ['open', 'point']) {
    const t = createHandTracker({ smoothing: 1 });
    t.update(hand(0.5, 0.5, pose));
    const s = t.update(hand(0.3, 0.5, pose));
    assert.deepEqual([s.grabbing, s.dx, s.dy], [false, 0, 0]);
  }
});

test('dx sale en altos de imagen: con una imagen 4:3 el mismo gesto horizontal cuenta 4/3', () => {
  const t = createHandTracker({ smoothing: 1 });
  t.update(hand(0.5, 0.5, 'pinch'), 4 / 3);
  near(t.update(hand(0.4, 0.5, 'pinch'), 4 / 3).dx, 0.1 * 4 / 3);
});

test('entre los dos umbrales el agarre se mantiene y no empieza (histéresis)', () => {
  const half = (cx, cy) => { const lm = hand(cx, cy, 'pinch'); lm[4] = { x: lm[8].x - 0.38 * SIZE, y: lm[8].y }; return lm; };
  const t = createHandTracker();
  assert.equal(t.update(half(0.5, 0.5)).grabbing, false);
  assert.equal(t.update(hand(0.5, 0.5, 'pinch')).grabbing, true);
  assert.equal(t.update(half(0.5, 0.5)).grabbing, true);
  assert.equal(t.update(hand(0.5, 0.5, 'open')).grabbing, false);
});

test('si la mano se pierde, al volver no hay salto aunque siga en pinza', () => {
  const t = createHandTracker({ smoothing: 1 });
  t.update(hand(0.2, 0.2, 'pinch'));
  t.update(hand(0.25, 0.2, 'pinch'));
  t.update(null);
  const back = t.update(hand(0.8, 0.8, 'pinch'));
  assert.deepEqual([back.grabbing, back.dx, back.dy], [true, 0, 0]);
  near(t.update(hand(0.7, 0.8, 'pinch')).dx, 0.1);
});

test('el suavizado reparte el movimiento en varios fotogramas', () => {
  const t = createHandTracker({ smoothing: 0.5 });
  t.update(hand(0.5, 0.5, 'pinch'));
  near(t.update(hand(0.4, 0.5, 'pinch')).dx, 0.05);
  near(t.update(hand(0.4, 0.5, 'pinch')).dx, 0.025);
});

test('una pinza en cada mano hace zoom con la distancia entre ellas, y no arrastra', () => {
  const t = createHandsTracker({ smoothing: 1 });
  const first = t.update([hand(0.4, 0.5, 'pinch'), hand(0.6, 0.5, 'pinch')]);
  assert.deepEqual([first.zooming, first.scale], [true, 1]);
  const apart = t.update([hand(0.3, 0.5, 'pinch'), hand(0.7, 0.5, 'pinch')]);
  near(apart.scale, 2);
  assert.equal(apart.dx, 0);
  near(t.update([hand(0.4, 0.5, 'pinch'), hand(0.6, 0.5, 'pinch')]).scale, 0.5);
});

test('el zoom no depende del orden en que llegan las manos', () => {
  const t = createHandsTracker({ smoothing: 1 });
  t.update([hand(0.4, 0.5, 'pinch'), hand(0.6, 0.5, 'pinch')]);
  const s = t.update([hand(0.7, 0.5, 'pinch'), hand(0.3, 0.5, 'pinch')]);
  near(s.scale, 2);
  // De izquierda a derecha del usuario (en espejo): la mano de x = 0,7 de la imagen queda a la izquierda.
  near(s.hands[0].x, 0.3);
});

test('una sola pinza no hace zoom, ni acercando la mano a la cámara', () => {
  const t = createHandsTracker({ smoothing: 1 });
  const base = hand(0.5, 0.5, 'pinch'), c = palmCentre(base);
  t.update([base]);
  const s = t.update([base.map(p => ({ x: c.x + (p.x - c.x) * 2, y: c.y + (p.y - c.y) * 2 }))]);
  assert.deepEqual([s.grabbing, s.zooming, s.scale], [true, false, 1]);
});

test('con dos manos y una sola pinza, esa mano arrastra', () => {
  const t = createHandsTracker({ smoothing: 1 });
  t.update([hand(0.3, 0.5, 'open'), hand(0.7, 0.5, 'pinch')]);
  const s = t.update([hand(0.3, 0.5, 'open'), hand(0.6, 0.5, 'pinch')]);
  assert.deepEqual([s.zooming, s.grabbing, s.scale], [false, true, 1]);
  near(s.dx, 0.1);
});

test('al aparecer o desaparecer una mano, ese fotograma ni arrastra ni hace zoom', () => {
  const t = createHandsTracker({ smoothing: 1 });
  t.update([hand(0.5, 0.5, 'pinch')]);
  const two = t.update([hand(0.2, 0.5, 'pinch'), hand(0.8, 0.5, 'pinch')]);
  assert.deepEqual([two.dx, two.dy, two.scale], [0, 0, 1]);
  const one = t.update([hand(0.8, 0.5, 'pinch')]);
  assert.deepEqual([one.dx, one.dy, one.scale], [0, 0, 1]);
  assert.deepEqual(t.update(null), { present: false, grabbing: false, zooming: false, hands: [], pointer: null, pressed: false, dx: 0, dy: 0, scale: 1, click: false, salute: false });
});

test('con una mano que apunta hay puntero y clic; sin apuntar o con dos manos, no', () => {
  const t = createHandsTracker({ smoothing: 1 });
  assert.equal(t.update([hand(0.3, 0.6, 'open')]).pointer, null);
  near(t.update([hand(0.3, 0.6, 'point')]).pointer.x, 1 - 0.27);
  const down = t.update([hand(0.3, 0.6, 'point', 'in')]);
  assert.deepEqual([down.click, down.pressed], [true, true]);
  t.update([hand(0.3, 0.5, 'point'), hand(0.7, 0.5, 'open')]);
  const two = t.update([hand(0.3, 0.5, 'point', 'in'), hand(0.7, 0.5, 'open')]);
  assert.deepEqual([two.pointer, two.click, two.pressed], [null, false, false]);
});

test('pointerToScreen lleva el centro de la imagen a toda la pantalla', () => {
  assert.deepEqual(pointerToScreen({ x: 0.5, y: 0.5 }, 1000, 600, 0.2), { x: 500, y: 300 });
  assert.deepEqual(pointerToScreen({ x: 0.2, y: 0.8 }, 1000, 600, 0.2), { x: 0, y: 600 });
  assert.deepEqual(pointerToScreen({ x: 0.05, y: 0.99 }, 1000, 600, 0.2), { x: 0, y: 600 });
  near(pointerToScreen({ x: 0.35, y: 0.5 }, 1000, 600, 0.2).x, 250);
});

test('la portada solo tiene control con las manos en «Explorar la Luna» (#259)', async () => {
  const { readFile } = await import('node:fs/promises');
  const html = await readFile(new URL('../home/index.html', import.meta.url), 'utf8');
  assert.equal(html.match(/class="[^"]*\bhandbtn\b[^"]*"/g)?.length, 1, 'un solo botón de manos');
  assert.match(html, /<div class="xp" id="xp">[\s\S]*id="handBtn"/, 'el botón está en «Explorar la Luna»');
  assert.match(html, /createHandPointer\(\{buttons:\[\$\("handBtn"\)\],resume:false,/, 'no se enciende solo en el menú');
  const body = name => html.slice(html.indexOf(`function ${name}(`), html.indexOf('\n}', html.indexOf(`function ${name}(`)));
  assert.match(body('openExplore'), /hands\.resume\(\)/, 'se vuelve a encender al entrar');
  assert.match(body('exitExplore'), /hands\.pause\(\)/, 'se apaga al volver al menú');
});

/** La mano abierta girada `deg` grados alrededor de su palma (positivo: los dedos hacia la derecha de la imagen). */
function tilted(cx, cy, deg, pose = 'open') {
  const lm = hand(cx, cy, pose), c = palmCentre(lm), a = deg * Math.PI / 180;
  return lm.map(p => ({ x: c.x + (p.x - c.x) * Math.cos(a) - (p.y - c.y) * Math.sin(a), y: c.y + (p.x - c.x) * Math.sin(a) + (p.y - c.y) * Math.cos(a) }));
}

test('el saludo: la mano plana, de lado y a la altura de la cabeza, con cualquiera de las dos manos', () => {
  assert.equal(isSalute(tilted(0.3, 0.3, 70)), true);
  assert.equal(isSalute(tilted(0.7, 0.3, -70)), true, 'la otra mano, hacia el otro lado');
  assert.equal(isSalute(tilted(0.3, 0.3, 45)), true, 'con los dedos algo hacia arriba');
  assert.equal(isSalute(tilted(0.3, 0.3, 0)), false, 'la mano abierta con los dedos arriba no saluda');
  assert.equal(isSalute(tilted(0.3, 0.3, 150)), false, 'con los dedos hacia abajo, no');
  assert.equal(isSalute(tilted(0.3, 0.75, 70)), false, 'abajo en la imagen, lejos de la cabeza, no');
  assert.equal(isSalute(tilted(0.3, 0.3, 70, 'point')), false, 'apuntando, no');
  assert.equal(isSalute(tilted(0.3, 0.3, 70, 'fist')), false, 'con el puño, no');
  const spread = tilted(0.3, 0.3, 70);
  spread[20] = { x: spread[20].x, y: spread[20].y + 0.25 };
  assert.equal(isSalute(spread), false, 'con los dedos separados, no');
});

test('el saludo cuenta una vez, tras mantenerlo unos fotogramas, y vuelve a contar al repetirlo', () => {
  const t = createHandsTracker({ saluteFrames: 3, saluteMisses: 1 });
  const salute = () => t.update([tilted(0.3, 0.3, 70)]).salute;
  assert.deepEqual([salute(), salute(), salute(), salute(), salute()], [false, false, true, false, false]);
  t.update([tilted(0.3, 0.3, 0)]);
  t.update([tilted(0.3, 0.3, 0)]);
  assert.deepEqual([salute(), salute(), salute()], [false, false, true]);
  const shown = createHandsTracker({ saluteFrames: 1 });
  assert.equal(shown.update([hand(0.5, 0.3, 'open')]).salute, false, 'enseñar la mano abierta no es un saludo');
});

test('el saludo aguanta algún fotograma suelto sin él (junto a la cara el seguimiento parpadea)', () => {
  const t = createHandsTracker({ saluteFrames: 4, saluteMisses: 2 });
  const frame = deg => t.update([tilted(0.3, 0.3, deg)]).salute;
  assert.deepEqual([frame(70), frame(70), frame(0), frame(70), frame(70)], [false, false, false, false, true]);
  const lost = createHandsTracker({ saluteFrames: 4, saluteMisses: 2 });
  const f = deg => lost.update([tilted(0.3, 0.3, deg)]).salute;
  assert.deepEqual([f(70), f(70), f(0), f(0), f(0), f(70), f(70)], [false, false, false, false, false, false, false], 'tres fallos seguidos empiezan de nuevo');
});

test('el saludo con la mano de canto: los dedos se ven más cortos y el meñique algo doblado', () => {
  // Cada yema, a una fracción del camino desde la base de su dedo: de canto, un dedo recto parece más corto.
  const shorten = (lm, k) => lm.map((p, i) => {
    const base = { 8: 5, 12: 9, 16: 13, 20: 17 }[i];
    return base === undefined ? p : { x: lm[base].x + (p.x - lm[base].x) * k[i], y: lm[base].y + (p.y - lm[base].y) * k[i] };
  });
  const edge = shorten(tilted(0.3, 0.3, 60), { 8: 0.5, 12: 0.5, 16: 0.5, 20: 0.25 });
  const reach = fingerReach(edge);
  assert.ok(reach.slice(0, 3).every(r => r > 1.3 && r < 1.5) && reach[3] < 1.3, `alcance ${reach.map(r => r.toFixed(2))}`);
  assert.equal(isSalute(edge), true);
});

test('el saludo gana a apuntar: de canto, el índice se ve más largo y los otros parecen doblados', () => {
  // Índice 1,84, corazón 1,34, anular 1,33 y meñique 1,30: es un saludo y, sin la prioridad, también apuntaría.
  const shorten = (lm, k) => lm.map((p, i) => {
    const base = { 8: 5, 12: 9, 16: 13, 20: 17 }[i];
    return base === undefined ? p : { x: lm[base].x + (p.x - lm[base].x) * k[i], y: lm[base].y + (p.y - lm[base].y) * k[i] };
  });
  const edge = shorten(tilted(0.3, 0.3, 60), { 8: 0.85, 12: 0.345, 16: 0.34, 20: 0.3 });
  const [index, ...others] = fingerReach(edge);
  assert.ok(index > 1.5 && others.filter(r => r < 1.35).length >= 2, 'con estas medidas apuntaría');
  assert.equal(isSalute(edge), true);
  const t = createHandsTracker({ saluteFrames: 3 });
  const frames = [1, 2, 3].map(() => t.update([edge]));
  assert.deepEqual(frames.map(s => [!!s.pointer, s.salute]), [[false, false], [false, false], [false, true]]);
  // Y también si la mano ya estaba apuntando al subir hacia la cabeza (los límites laxos de seguir apuntando).
  const raised = createHandsTracker({ saluteFrames: 2 });
  raised.update([hand(0.3, 0.3, 'point')]);
  assert.deepEqual([raised.update([edge]).salute, raised.update([edge]).salute], [false, true]);
});
