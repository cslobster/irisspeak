#!/bin/sh
# Upload the model files in site/public/model to the R2 bucket behind https://model.irisspeak.org.
# Chunks live under a version directory (immutable, long cache); the small metadata files keep their names
# and get a short cache so a new version is picked up on the next app load.
#   sh site/upload_model.sh v3
set -e
VER="$1"; [ -n "$VER" ] || { echo "usage: $0 <version dir, e.g. v3>"; exit 1; }
cd "$(dirname "$0")/public/model"
unset CLOUDFLARE_API_TOKEN
put() { npx --yes wrangler@latest r2 object put "irisspeak-model/$1" --file "$2" --content-type "$3" --cache-control "$4" --remote >/dev/null && echo "  up $1"; }
for f in "$VER"/card_model_fp16.part* "$VER"/realiser_fp16.part*; do [ -f "$f" ] && put "$f" "$f" application/octet-stream "public, max-age=31536000, immutable"; done
put card_vecs.bin card_vecs.bin application/octet-stream "public, max-age=300"
for f in manifest.json cards.json reranker.json freq.json realiser_manifest.json; do [ -f "$f" ] || continue; put "$f" "$f" application/json "public, max-age=300"; done
echo "uploaded $VER"
