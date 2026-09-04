#!/usr/bin/env bash
# 1) Vercel deploy  2) Usion registry-д бүртгэх
set -e
cd "$(dirname "$0")"
python3 build.py
URL=$(npx --yes vercel dist --prod --yes 2>/dev/null | grep -Eo 'https://[a-z0-9.-]+\.vercel\.app' | tail -1)
echo "Deployed: $URL"
export USION_BASE_URL="$URL"
: "${USION_API_TOKEN:?export USION_API_TOKEN=usion_sk_...}"
python3 publish.py
