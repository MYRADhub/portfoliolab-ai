#!/usr/bin/env bash
# Rebuilds the paper from the real-data database: export the figures, re-check them independently, typeset.
# Needs the real-data database (pnpm real:seed and friends), Python 3 and tectonic.
set -euo pipefail
here="$(cd "$(dirname "$0")" && pwd)"
root="$(dirname "$here")"
set -a
# shellcheck disable=SC1091
. "$root/.env"
set +a
DATABASE_URL="${DATABASE_URL%/*}/pl_real"
export DATABASE_URL
(cd "$root/apps/web" && pnpm exec tsx scripts/paper-export.mts)
python3 "$here/check.py"
(cd "$here" && tectonic -X compile main.tex)
cp "$here/main.pdf" "$root/docs/paper.pdf"
echo "paper written to docs/paper.pdf"
