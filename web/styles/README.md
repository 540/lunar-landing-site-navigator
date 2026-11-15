# Design system de `web/`

Sistema básico para cambiar el aspecto de la web sin buscar colores ni tamaños sueltos por el código. No hay build ni dependencias: son CSS y módulos JS.

Catálogo con todos los tokens y componentes: `node web/serve.mjs` → <http://localhost:4542/web/design-system.html>.

## Piezas y orden de carga

| Fichero | Qué contiene |
|---|---|
| `tokens.css` | Tokens. **Primitivos** (paleta y escalas: `--gray-800`, `--green-400`…) y **semánticos** (`--color-surface`, `--color-ok`, `--space-3`, `--text-sm`…). Fuera de este fichero solo se usan los semánticos |
| `components.css` | Componentes reutilizables y utilidades de disposición (`.stack`, `.row`, `.grid`, `.tiles`) |
| `base.css` | Reset, tipografía, ayudas de texto (`.eyebrow`, `.num`, `.hint`, `.reason`, `.text-*`), barra superior, disposición con lateral, mapa y modo explicación. Importa `tokens.css` |
| `plan.css`, `advanced.css`, `replan.css`, `sources.css` | Lo propio de cada vista |
| `tour.css` | El tutorial de la primera visita (foco y bocadillo). Toma los colores de `tokens.css`: las pantallas de fuera de `web/`, como `home/`, enlazan `tokens.css` antes que él |
| `../js/common/ui.js` | Los componentes como funciones que devuelven HTML y escapan el texto |
| `../js/common/theme.js` | `theme()` lee los tokens para los canvas. `VERDICT_TONE` traduce `viable` / `marginal` / `not_viable` a `ok` / `warn` / `bad` |

En `index.html` el orden es `components.css` → `base.css` (que importa `tokens.css`) → vistas → `motion/motion.css`. El laboratorio `motion/index.html` enlaza lo mismo. Los modificadores se escriben `.btn.btn--primary` o `.box.box--roomy`, con la clase base delante.

## Recetas

- **Cambiar un color en toda la web**, gráficos incluidos: edita el token semántico en `tokens.css`. Por ejemplo, `--color-ok: var(--green-400)`.
- **Tema claro** (#83): ya existe. Los semánticos se redefinen bajo `:root[data-theme="light"]` en `tokens.css`; ningún componente ni vista define colores propios. `js/theme-init.js` pone `data-theme` en `<html>` antes de pintar (la elección guardada en `localStorage`, `llsn.theme`; si no hay, **oscuro**, sea cual sea el del sistema) y el botón de la Luna de la barra lo cambia (una Luna pequeña con la textura del fondo: creciente fino en oscuro, llena en claro, y al pasar por encima la sombra se mueve a media fase) (`initThemeToggle` de `theme.js`). Los canvas se repintan solos porque leen los tokens al dibujar. Para cambiar un color en claro, edita su token dentro de ese bloque.
- **Fondo**: la superficie de la Luna (`assets/regolith.jpg`, recorte del mapa de albedo LROC de `shared/render/tex/` alrededor de Copérnico y el Mar de las Lluvias). En claro es la cara iluminada: el regolito tal cual, cálido bajo el Sol (como la Luna 3D de la portada), con luz arriba para el encabezado, el borde oscurecido y tarjetas de cristal color hueso. En oscuro es la cara en sombra: la misma textura multiplicada por un azul noche, con un resplandor terrestre arriba a la derecha. Lo regulan `--bg-image` y `--bg-blend`; las tarjetas son cristal (`--surface-blur`). El texto que va directamente sobre el suelo (títulos e introducciones de cada vista) lleva un halo del tono de la página (`--text-halo`, en `.main`); lo que tiene fondo propio lo quita. Si un texto pequeño queda sobre el suelo, ponlo en un panel (`.box` o el mismo cristal), porque el halo no basta para letra de 11–12 px. El cielo de estrellas (`js/common/sky.js`) queda apagado (`--sky-opacity: 0`).
- **Mapas**: el relieve LOLA es una imagen oscura en los dos temas, así que lo que se pinta encima usa `--color-map-*`, que no cambian con el tema.
- **Más o menos aire**: cambia la escala `--space-*` o el `padding` de `.box`.
- **Otra tipografía**: cambia `--font-*` y el `<link>` de Google Fonts en `index.html` y `design-system.html`.
- **Componente nuevo**: va a `components.css` con un comentario que muestre su HTML, su función a `js/common/ui.js` si se genera desde JS, y un ejemplo a `design-system.html`. Es zona común: PR revisado por los tres.
- **Algo de una sola vista**: va a su CSS (`plan.css`…), usando los tokens semánticos.

## Reglas

1. Fuera de `tokens.css` no se escriben colores, fuentes ni tamaños a mano: siempre `var(--…)`.
2. El tono se indica con un atributo, no con una clase de color: `data-tone="ok|warn|bad|neutral"` en las insignias y `data-tone="sun|earth"` en las métricas.
3. Los canvas leen los colores de los tokens: `theme()` de `theme.js` o `css('--color-…')` de `util.js`. Nunca un color escrito a mano. Sobre el relieve de un mapa, los `--color-map-*` (`t.mapLine`, `t.mapMark`…).
4. Las clases siguen un BEM ligero en inglés: `.box`, `.box__head`, `.box--roomy`.
5. Los colores de veredicto (`--color-ok`, `--color-warn`, `--color-bad`) son los de todo el sitio (#341): el Mirador, el juego y el aterrizaje enlazan `tokens.css` y sus `--ok`, `--warn` y `--bad` apuntan a los `--color-map-*`. El aviso es amarillo (`--amber-400`, `#e6c14d`) para no confundirse con el Sol (`--orange-400`).

## Migración (histórico)

Hecha el 2026-11-14: las cuatro vistas, la zona común y el laboratorio de movimiento usan ya los tokens semánticos y los componentes; `aliases.css` y las reglas antiguas de `base.css` se han borrado. Las tablas siguientes quedan como referencia de los nombres antiguos, por si aparecen en ramas viejas.

### Tokens

| Antiguo | Nuevo |
|---|---|
| `--bg` | `--color-bg` |
| `--panel` / `--panel-2` | `--color-surface` / `--color-surface-raised` |
| `--sky` / `#121418` | `--color-sunken` / `--color-sunken-deep` |
| `--ink` / `--muted` | `--color-text` / `--color-text-muted` |
| `--line` | `--color-border` |
| `--regolith` | `--color-terrain` |
| `--sun` / `--earth` | `--color-sun` / `--color-earth` |
| `--ok` / `--warn` / `--bad` | `--color-ok` / `--color-warn` / `--color-bad` |
| `--ok-bg` / `--warn-bg` / `--bad-bg` | `--color-ok-soft` / `--color-warn-soft` / `--color-bad-soft` |
| `--debug` / `--debug-bg` | `--color-explain` / `--color-explain-soft` |
| `--font-display` / `--font-body` / `--font-data` | Sin cambio |
| Tamaños sueltos (`0.74rem`, `12px`…) | `--text-*`, `--space-*`, `--radius-*` |

### Clases

| Antes | Ahora |
|---|---|
| `.pill.viable` / `.marginal` / `.not_viable` | `UI.verdict(v)` → `.badge.badge--pill[data-tone]` |
| `.status.simulated` … | `.badge[data-tone]` |
| `.demo-tag` | `.badge.badge--outline[data-tone="warn"]` |
| `.btn.primary` / `.btn.active` | `.btn--primary` / `.btn--explain[aria-pressed="true"]` |
| `.box-head` | `.box__head` |
| `.card`, `.exit`, `.plan-result-card` | `.box` (+ `.box--roomy` y la clase propia de la vista si hace falta) |
| `.plan-block` | `.field-group` |
| `.row2` / `.row3` / `.row4` | `.grid` con `style="--cols: N"` (y `--cols-narrow`) |
| `.cards`, `.rp-exits` | `.tiles` con `style="--min: 260px"` |
| `.profiles` / `.profile-option` | `.options` / `.option` o `UI.option()` |
| `.sites` / `.site` / `.check` / `.name` | `.list` / `.selectable` / `__check` / `__name` o `UI.selectable()` |
| `.timebar` / `.play` / `.timebar-text` | `.player` / `.player__play` / `.player__text` |
| `.metric.sun` / `.metric.earth` | `.metric[data-tone="sun\|earth"]` o `UI.metric()` |
| `.res-figures` | `.figures` + `.figure` o `UI.figures()` |
| `.deviation-points` | `.dots` o `UI.dots()` |
| `.views` | `.tabs` |
| `.plan-title` / `.res-site` / `.advanced-title` | `.headline` / `.featured` / `.box-title` |
| `.text-ok` / `.text-bad` | Sin cambio (más `.text-sun`, `.text-earth`) |
| `css('--sun')` en canvas | `theme().sun` |
| `verdictColor(code)` | Sigue en `util.js` (lee `--color-ok/warn/bad`); para estilos en línea, `verdictCssVar(code)` de `theme.js` |
