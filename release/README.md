# Release

Un workflow de Claude (`workflow.mjs`) que prepara y publica una release del código. Se lanza con `release.sh`. Para unir los cambios con historias e iniciativas lee el repo de discovery (`lunar-landing-site-navigator-discovery`): lo busca clonado en una carpeta hermana, o en la ruta de `$DISCOVERY`. Sin él, funciona igual pero no mueve iniciativas.

```sh
./release/release.sh                 # prepara: no toca nada
./release/release.sh --publicar      # publica
```

## Qué hace

| Fase | Quién | Qué |
|---|---|---|
| Recoger | un agente | Commits, PR e issues cerrados desde la última etiqueta `vX.Y.Z`, unidos con las historias e iniciativas del repo de discovery (`iniciativas/*/prd.md`, sección 8). No cuenta como producto lo que solo toca documentación, CI o `release/` |
| Verificar | agentes en paralelo | Uno ejecuta los tests y el build (los que declaren `CLAUDE.md`, `README.md` o `package.json`). Uno por historia entregada (hasta 8) comprueba sus criterios de aceptación leyendo el código |
| Decidir | **código** | Versión: la primera es `v0.1.0`; algo nuevo o un cambio sube la minor; solo arreglos, la patch. Bloqueos: un test en rojo o un criterio incumplido. Iniciativa entregada: todas sus historias entregadas y ninguna fallando |
| Notas | un agente | Release notes en español, agrupadas por iniciativa, y un resumen de tres líneas para la demo |
| Publicar | un agente, solo con `--publicar` y sin bloqueos | `CHANGELOG.md`, commit `release: vX.Y.Z`, etiqueta, push y release de GitHub; en el repo de discovery, iniciativas entregadas a `midiendo` (con fila en su Historial), commit y push |

## Release automática tras cada commit

`.githooks/post-commit` lanza `release/auto.sh` después de cada commit. Solo publica cuando el commit está en `main` y cambia el producto; los que solo tocan documentación, CI o `release/`, los de otras ramas y los propios `release: vX.Y.Z` no la disparan. Corre en segundo plano, una sola a la vez, y avisa con una notificación de macOS al terminar (publicada, bloqueada o fallida). El registro queda en `release/.auto.log`.

Se activa por máquina, con `git config core.hooksPath .githooks`. Conviene activarlo en **una sola máquina**: la que tenga sesión de `claude`, porque cada release lanza agentes. Para saltarlo en un commit: `SIN_RELEASE=1 git commit …`.

Ojo: un hook local solo ve los commits hechos en esa máquina. Lo que entre en `main` por un PR mergeado en GitHub no lo dispara hasta el siguiente commit local; para eso haría falta una GitHub Action.

## Versión del sitio

El deploy de Pages también numera: cada deploy que cambia el sitio crea su etiqueta `vX.Y.Z` ([`tools/version/`](../tools/version/README.md)). La release parte de la última etiqueta, sea de un deploy o de otra release, así que sus notas cubren lo que ha entrado desde entonces. El deploy de un commit `release: vX.Y.Z` muestra esa versión y deja que la etiqueta la ponga la release.

## Opciones

| Opción | Efecto |
|---|---|
| `--publicar` | Publica. Exige el árbol de trabajo limpio |
| `--version 0.3.0` | Fija la versión en vez de calcularla |
| `--forzar` | Prepara aunque no haya cambios de producto, o publica aunque haya bloqueos |

Sin `--publicar`, Claude solo tiene permisos de lectura (git, gh y los comandos de test). El resultado completo queda en `release/.ultima.json`.

## Cómo encaja

Es la salida de la fase 5 del ciclo de discovery y la entrada de la 6: las iniciativas entregadas pasan a `midiendo`, y ahí toca comparar sus métricas con el PRD y decidir (`/grill-me`, sección 9 del PRD).
