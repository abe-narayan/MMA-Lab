#!/usr/bin/env bash
# Snapshot the working tree's src + scripts into the scratchpad and run a batch
# from the snapshot, so src/sim can keep changing while the batch runs.
#   scripts/dev/snap-run.sh <label> <batch args...>
# Results land in runs/<label> of the *repo* (absolute path).
set -e
REPO=/c/Users/abena/Downloads/bout-lab-repo/mma-sim
SCR="C:/Users/abena/AppData/Local/Temp/claude/C--Users-abena-Downloads-bout-lab-repo-mma-sim/4b478565-865d-498a-bfaf-9a2cdb49bb77/scratchpad/realism/snap-$1"
LABEL=$1; shift
rm -rf "$SCR"; mkdir -p "$SCR"
cp -r "$REPO/src" "$REPO/scripts" "$REPO/tsconfig.json" "$REPO/package.json" "$SCR/"
ln -s "$REPO/node_modules" "$SCR/node_modules"
cd "$SCR"
node "$REPO/scripts/dev/heavy.mjs" npx tsx scripts/batch/run.ts "$@" --out "$REPO/runs/$LABEL" > "$REPO/runs/$LABEL.log" 2>&1
