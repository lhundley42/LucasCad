#!/usr/bin/env bash
cd -- "$(dirname -- "$0")" || exit 1
bash ./start-cad.sh "$@"
status=$?
if [ "$status" -ne 0 ]; then
    read -r -p 'LucasCad could not start. Press Return to close.' _
fi
exit "$status"
