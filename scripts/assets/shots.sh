#!/usr/bin/env bash
# Lookdev capture helper: shots.sh <outdir> <name> "<query>" [WxH]
out=$1; name=$2; query=$3; size=${4:-1600x900}
node scripts/dev/heavy.mjs node scripts/dev/shot.mjs "\"http://127.0.0.1:5180/dev/character.html?clean=1&$query\"" "$out/$name.png" --size $size --wait 2500 --until "\"window.__ready === true\"" 2>&1 | grep -v DEP0 | grep -v trace-dep | grep -v "404" | grep -v "console error" | cut -c1-400
