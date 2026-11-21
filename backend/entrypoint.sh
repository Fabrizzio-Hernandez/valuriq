#!/bin/sh
set -e

echo "[Valuriq] Ejecutando migraciones Alembic (alembic upgrade head)..."
alembic upgrade head

echo "[Valuriq] Iniciando FastAPI en 0.0.0.0:${PORT:-8000}..."
exec uvicorn app.main:app --host 0.0.0.0 --port "${PORT:-8000}"
