#!/usr/bin/env bash
set -eu

if [ -z "${DATABASE_URL:-}" ]; then
    echo "DATABASE_URL is required. Configure a Neon PostgreSQL connection string in Vercel." >&2
    exit 1
fi

case "$DATABASE_URL" in
    postgres://*|postgresql://*|postgresql+psycopg://*) ;;
    *)
        echo "Vercel requires a PostgreSQL DATABASE_URL; SQLite is not persistent on Vercel." >&2
        exit 1
        ;;
esac

cd "$(dirname "$0")/heat-project/backend"
python -m alembic upgrade head
