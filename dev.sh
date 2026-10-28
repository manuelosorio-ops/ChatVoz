#!/usr/bin/env bash
# Cami · levanta backend (FastAPI :8000) y frontend (Vite :5173) con un solo comando.
# Uso: ./dev.sh            (Ctrl+C detiene ambos)
#      ./dev.sh --install  (fuerza reinstalar dependencias)
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
BACK="$ROOT/backend"
FRONT="$ROOT/frontend"
BACK_PORT="${BACK_PORT:-8000}"
FORCE_INSTALL=false
[[ "${1:-}" == "--install" ]] && FORCE_INSTALL=true

C_BACK=$'\033[36m'; C_FRONT=$'\033[35m'; C_INFO=$'\033[33m'; C_ERR=$'\033[31m'; C_OFF=$'\033[0m'
info() { printf "%s▶ %s%s\n" "$C_INFO" "$*" "$C_OFF"; }
fail() { printf "%s✖ %s%s\n" "$C_ERR" "$*" "$C_OFF" >&2; exit 1; }

# --- Requisitos ---
command -v python3 >/dev/null || fail "No se encontró python3 (instala Python 3.10+)."
command -v npm     >/dev/null || fail "No se encontró npm (instala Node 18+)."

# --- Backend: entorno virtual y dependencias ---
if $FORCE_INSTALL || [[ ! -x "$BACK/.venv/bin/uvicorn" ]] || [[ "$BACK/requirements.txt" -nt "$BACK/.venv/.installed" ]]; then
  info "Instalando dependencias del backend..."
  [[ -d "$BACK/.venv" ]] || python3 -m venv "$BACK/.venv"
  "$BACK/.venv/bin/pip" install -q --upgrade pip
  "$BACK/.venv/bin/pip" install -q -r "$BACK/requirements.txt"
  touch "$BACK/.venv/.installed"
fi

if [[ ! -f "$BACK/.env" ]]; then
  cp "$BACK/.env.example" "$BACK/.env"
  info "Se creó backend/.env desde .env.example: agrega tu AZURE_OPENAI_API_KEY."
fi

# --- Frontend: dependencias ---
if $FORCE_INSTALL || [[ ! -d "$FRONT/node_modules" ]] || [[ "$FRONT/package.json" -nt "$FRONT/node_modules/.package-lock.json" ]]; then
  info "Instalando dependencias del frontend..."
  (cd "$FRONT" && npm install --no-audit --no-fund --loglevel=error)
fi

# --- Puerto ocupado ---
if command -v lsof >/dev/null && lsof -iTCP:"$BACK_PORT" -sTCP:LISTEN -t >/dev/null 2>&1; then
  fail "El puerto $BACK_PORT ya está en uso. Cierra el proceso anterior (lsof -i :$BACK_PORT)."
fi

# --- Arranque ---
prefix() { awk -v p="$1" -v c="$2" -v o="$C_OFF" '{ print c p o " " $0; fflush() }'; }

cleanup() {
  trap - INT TERM EXIT
  printf "\n"; info "Deteniendo Cami..."
  kill 0 2>/dev/null || true
}
trap cleanup INT TERM EXIT

info "Backend  → http://localhost:$BACK_PORT/api/health"
info "Frontend → http://localhost:5173"
echo

(cd "$BACK" && exec .venv/bin/uvicorn main:app --reload --port "$BACK_PORT" 2>&1) | prefix "[back] " "$C_BACK" &
(cd "$FRONT" && exec npm run dev 2>&1) | prefix "[front]" "$C_FRONT" &

wait
