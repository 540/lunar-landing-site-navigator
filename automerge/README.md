# Fusión automática

Fusiona solas las PR que abre la software-factory, de cualquier persona del equipo, sin gastar minutos de CI: corre en un Mac, no en GitHub Actions. Basta con instalarlo en **una sola máquina**.

```sh
./automerge/install.sh            # instala el LaunchAgent: cada 2 minutos
./automerge/install.sh --remove   # lo quita
AUTOMERGE_DRY_RUN=1 ./automerge/automerge.sh   # dice qué fusionaría, sin tocar nada
```

## Qué hace en cada pasada

1. Busca las PR abiertas hacia `main` con rama del runner, `feat/<issue>-<slug>`, cuya issue lleva la etiqueta `agent-lunar`, la abra quien la abra. Una PR hecha a mano, o de una issue sin esa etiqueta, no la toca.
2. Deja esperar las que tienen el último commit de hace menos de 5 minutos (el runner puede seguir empujando), las que la revisión del runner aún no ha aprobado en su último commit (el comentario «# PR Analysis» con «Analyzed head» igual al commit de la PR y «Result: APPROVED»; si pide cambios, el runner los arregla y vuelve a revisar) y las que GitHub no da por fusionables (conflictos, o aún calculándolo: lo reintenta en la siguiente pasada).
3. Quita el borrador, fusiona con **rebase** (historial lineal en `main`, como commits directos; con squash si la rama trae un merge de `main` y no se deja rebasar), borra la rama remota y cierra la issue (las PR del runner no dicen «Closes #N», y una issue bloqueada espera a que su bloqueo se cierre).
4. Tras fusionar, hace `git pull --ff-only` en esta copia si está en `main` y limpia, y lanza `release/auto.sh`: si el commit cambia el producto, sale la release (ver [`../release/README.md`](../release/README.md)).

No vuelve a pasar los tests: el runner ejecuta `npm test` antes de abrir la PR (lo declara `.claude/epic-runner.json`).

## Ajustes

| Variable | Por defecto | Qué cambia |
|---|---|---|
| `AUTOMERGE_REPO` | `540/lunar-landing-site-navigator` | Repo de las PR |
| `AUTOMERGE_LABEL` | `agent-lunar` | Etiqueta que tiene que llevar la issue |
| `AUTOMERGE_AUTHOR` | vacío: cualquiera | Solo las PR de este autor |
| `AUTOMERGE_BRANCH_PREFIX` | `feat/` | Prefijo de rama |
| `AUTOMERGE_MIN_AGE_MIN` | `5` | Minutos desde el último commit antes de fusionar |
| `AUTOMERGE_REQUIRE_REVIEW` | `1` | Con `0`, no espera a la revisión del runner |
| `AUTOMERGE_DRY_RUN` | `0` | Con `1`, solo dice qué haría |

Registro: `~/Library/Logs/lunar-automerge.log`. Solo funciona con ese Mac encendido.
