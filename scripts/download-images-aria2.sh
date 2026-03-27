#!/usr/bin/env zsh
set -euo pipefail

mkdir -p cache/milady-maker

seq 1 10000 | awk -v dir="$PWD/cache/milady-maker" '{
  printf "https://www.miladymaker.net/milady/%d.png\n out=%d.png\n dir=%s\n", $1, $1, dir
}' > cache/milady-maker.aria2.txt

aria2c \
  --input-file=cache/milady-maker.aria2.txt \
  --continue=true \
  --allow-overwrite=false \
  --auto-file-renaming=false \
  --max-concurrent-downloads=32 \
  --split=4 \
  --max-connection-per-server=4 \
  --min-split-size=1M \
  --retry-wait=2 \
  --max-tries=8
