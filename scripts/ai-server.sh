#!/usr/bin/env bash
# Start llama.cpp's llama-server with the pinned Qwen model on 127.0.0.1:8080, for pipeline/ai.py (PLAN.md P1-B).
# Downloads into $AI_DIR (default ~/.cache/khabar-ai; the workflow keeps it in the Actions cache, keyed on this file's
# hash, so changing a pin below downloads again), checks every file's SHA-256, then waits until the model answers.
# Linux x64 (the runner) and macOS arm64 (a Mac, for the backfill). Stop it with: kill "$(cat "$AI_DIR/server.pid")"
set -euo pipefail

LLAMA_TAG=b12494
LLAMA_LINUX_SHA=6cc888fce5d0951e543289f07a24337ef29e52165ee3fb2aa16743253c160eaf
LLAMA_MAC_SHA=cb4a5089fcaaa69a493bbf86eae25002dd82966eacecd166c49282881906ab3a
# Qwen3.5-9B, 4-bit (Q4_K_M, 5.7 GB): the newest small Qwen when this was set up. On the golden set
# (pipeline/tests/golden.json, .github/workflows/ai-eval.yml, 2026-11-18): 38/39 headlines pass the rules, type right
# 30/39, ~21 s a post on the 4-vCPU runner (57 s for the first, which reads the shared instructions). Its topics were
# worse than the keyword rules (precision 49% vs 72%), so the site keeps the rules' topics.
# Another candidate for a bake-off: set all four (.github/workflows/ai-eval.yml).
MODEL_REPO=${MODEL_REPO:-unsloth/Qwen3.5-9B-GGUF}
MODEL_REV=${MODEL_REV:-3885219b6810b007914f3a7950a8d1b469d598a5}
MODEL_FILE=${MODEL_FILE:-Qwen3.5-9B-Q4_K_M.gguf}
MODEL_SHA=${MODEL_SHA:-03b74727a860a56338e042c4420bb3f04b2fec5734175f4cb9fa853daf52b7e8}

AI_DIR=${AI_DIR:-$HOME/.cache/khabar-ai}
PORT=${AI_PORT:-8080}
mkdir -p "$AI_DIR"
cd "$AI_DIR"

sha() { if command -v sha256sum >/dev/null; then sha256sum "$1" | cut -d' ' -f1; else shasum -a 256 "$1" | cut -d' ' -f1; fi; }
fetch() { # url file sha
  if [ -f "$2" ] && [ "$(sha "$2")" = "$3" ]; then return; fi
  echo "downloading $2"
  curl -fsSL --retry 3 -C - -o "$2.part" "$1" || curl -fsSL --retry 3 -o "$2.part" "$1"
  [ "$(sha "$2.part")" = "$3" ] || { echo "::error::$2: SHA-256 mismatch"; rm -f "$2.part"; exit 1; }
  mv "$2.part" "$2"
}

case "$(uname -s)-$(uname -m)" in
  Linux-x86_64) asset=ubuntu-x64; asset_sha=$LLAMA_LINUX_SHA ;;
  Darwin-arm64) asset=macos-arm64; asset_sha=$LLAMA_MAC_SHA ;;
  *) echo "no llama.cpp build pinned for $(uname -s)-$(uname -m)"; exit 1 ;;
esac
tarball="llama-$LLAMA_TAG-bin-$asset.tar.gz"
fetch "https://github.com/ggml-org/llama.cpp/releases/download/$LLAMA_TAG/$tarball" "$tarball" "$asset_sha"
server=$(find "llama-$LLAMA_TAG-$asset" -name llama-server -type f 2>/dev/null | head -1 || true)
if [ -z "$server" ]; then
  rm -rf "llama-$LLAMA_TAG-$asset" && mkdir "llama-$LLAMA_TAG-$asset" && tar -xzf "$tarball" -C "llama-$LLAMA_TAG-$asset"
  server=$(find "llama-$LLAMA_TAG-$asset" -name llama-server -type f | head -1)
fi
fetch "https://huggingface.co/$MODEL_REPO/resolve/$MODEL_REV/$MODEL_FILE" "$MODEL_FILE" "$MODEL_SHA"

# One request at a time (-np 1) keeps the long shared prefix (instructions + examples) in the cache between posts, so
# each post only pays for its own text. --jinja: the model's own chat template, which reads enable_thinking.
threads=$(getconf _NPROCESSORS_ONLN 2>/dev/null || echo 4)
nohup "$server" -m "$MODEL_FILE" --host 127.0.0.1 --port "$PORT" -c 8192 -np 1 -t "$threads" --jinja \
  --alias "${AI_MODEL:-qwen3.5-9b-q4_k_m}" >"$AI_DIR/server.log" 2>&1 &
echo $! >"$AI_DIR/server.pid"

for _ in $(seq 1 120); do
  if curl -fs "http://127.0.0.1:$PORT/health" >/dev/null 2>&1; then echo "llama-server ready on :$PORT"; exit 0; fi
  kill -0 "$(cat "$AI_DIR/server.pid")" 2>/dev/null || { tail -20 "$AI_DIR/server.log"; exit 1; }
  sleep 1
done
echo "llama-server did not start in 2 minutes"; tail -20 "$AI_DIR/server.log"; exit 1
