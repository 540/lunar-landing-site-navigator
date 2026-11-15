# Funciones compartidas por discovery/tick.sh y release/release.sh (se cargan con «.»).
#
# claude_headless <salida> <errores> <config-mcp> <prompt> [args de claude…]
# Lanza `claude -p` sin los MCP globales de la máquina (solo los de <config-mcp>),
# y lo cierra si ya imprimió su resultado y no sale en 30 s (un MCP que no se
# apaga lo deja colgado), o si pasa de CLAUDE_MAX_MIN minutos (30 por defecto).
claude_headless() {
  local salida="$1" errores="$2" mcp="$3" prompt="$4"; shift 4
  claude -p "$prompt" --strict-mcp-config --mcp-config "$mcp" "$@" > "$salida" 2> "$errores" &
  local pid=$! espera=0 tras_resultado=0 max=$(( ${CLAUDE_MAX_MIN:-30} * 60 ))
  while kill -0 "$pid" 2>/dev/null; do
    sleep 5; espera=$((espera + 5))
    if [ -s "$salida" ] && grep -q '}' "$salida"; then
      tras_resultado=$((tras_resultado + 5))
      if [ "$tras_resultado" -ge 30 ]; then
        echo "claude imprimió su resultado pero no salía: cerrado tras 30 s" >> "$errores"
        kill "$pid" 2>/dev/null; wait "$pid" 2>/dev/null; return 0
      fi
    fi
    if [ "$espera" -ge "$max" ]; then
      echo "claude superó ${CLAUDE_MAX_MIN:-30} minutos: cerrado" >> "$errores"
      kill "$pid" 2>/dev/null; wait "$pid" 2>/dev/null; return 124
    fi
  done
  wait "$pid"
}
