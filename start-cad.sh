#!/usr/bin/env bash
set -eu
PROJECT_ROOT=$(cd -- "$(dirname -- "$0")" && pwd)
if [ -n "${LUCASCAD_PYTHON:-}" ]; then
    candidates=("$LUCASCAD_PYTHON")
else
    candidates=("$PROJECT_ROOT/.venv/bin/python" python3.13 python3.12 python3.11 python3.14 python3)
fi
for candidate in "${candidates[@]}"; do
    if command -v "$candidate" >/dev/null 2>&1 && "$candidate" -c 'import sys; sys.exit(0 if (3,11) <= sys.version_info < (3,15) else 1)' 2>/dev/null; then
        exec "$candidate" "$PROJECT_ROOT/tools/launch_cad.py" "$@"
    fi
done
echo 'Install Python 3.11-3.14, then retry. LUCASCAD_PYTHON may specify an interpreter path.' >&2
exit 1
