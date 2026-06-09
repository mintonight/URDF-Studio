#!/usr/bin/env bash
set -euo pipefail

usage() {
  cat <<'EOF'
Build the standalone Collada mesh parser WebAssembly module.

Usage:
  scripts/build/rebuild-collada-mesh-parser-wasm.sh [options]

Options:
  --emsdk-env <path>    Path to emsdk_env.sh. If omitted, common local paths
                        are tried automatically.
  --source <path>       C++ source file.
                        Default: ./src/core/loaders/wasm/collada_mesh_parser.cpp
  --dest-dir <path>     Output directory.
                        Default: ./public/wasm/collada-mesh-parser
  --debug               Build with assertions and debug info.
  --help                Show this help.

Environment:
  EMSCRIPTEN_OPT_LEVEL=-O3
  EMSCRIPTEN_ENABLE_SIMD=1
EOF
}

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "${SCRIPT_DIR}/../.." && pwd)"

EMSDK_ENV=""
SOURCE_PATH="${ROOT_DIR}/src/core/loaders/wasm/collada_mesh_parser.cpp"
DEST_DIR="${ROOT_DIR}/public/wasm/collada-mesh-parser"
BUILD_VARIANT="release"
EMSCRIPTEN_OPT_LEVEL="${EMSCRIPTEN_OPT_LEVEL:--O3}"
EMSCRIPTEN_ENABLE_SIMD="${EMSCRIPTEN_ENABLE_SIMD:-1}"

while [[ $# -gt 0 ]]; do
  case "$1" in
    --emsdk-env)
      EMSDK_ENV="${2:-}"
      shift 2
      ;;
    --source)
      SOURCE_PATH="${2:-}"
      shift 2
      ;;
    --dest-dir)
      DEST_DIR="${2:-}"
      shift 2
      ;;
    --debug)
      BUILD_VARIANT="debug"
      shift
      ;;
    --help)
      usage
      exit 0
      ;;
    *)
      echo "Unknown option: $1" >&2
      usage >&2
      exit 1
      ;;
  esac
done

if [[ -z "${EMSDK_ENV}" ]]; then
  for candidate in \
    "${HOME}/.localdeps/emsdk/emsdk_env.sh" \
    "${HOME}/Project/_deps/emsdk/emsdk_env.sh"; do
    if [[ -f "${candidate}" ]]; then
      EMSDK_ENV="${candidate}"
      break
    fi
  done
fi

if [[ -n "${EMSDK_ENV}" ]]; then
  # shellcheck disable=SC1090
  source "${EMSDK_ENV}" >/dev/null
fi

if ! command -v emcc >/dev/null 2>&1; then
  echo "Missing emcc. Pass --emsdk-env <path> or source emsdk_env.sh first." >&2
  exit 1
fi

if [[ ! -f "${SOURCE_PATH}" ]]; then
  echo "Missing Collada mesh parser source: ${SOURCE_PATH}" >&2
  exit 1
fi

mkdir -p "${DEST_DIR}"

COMMON_FLAGS=(
  -std=c++17
  "${SOURCE_PATH}"
  -s WASM=1
  -s MODULARIZE=1
  -s EXPORT_ES6=1
  -s EXPORT_NAME=createColladaMeshParserModule
  -s ENVIRONMENT=web,worker,node
  -s FILESYSTEM=0
  -s ALLOW_MEMORY_GROWTH=1
  -s MALLOC=emmalloc
  -s EXPORTED_FUNCTIONS='["_malloc","_free","_parse_collada_mesh","_collada_mesh_parser_get_result_ptr","_collada_mesh_parser_get_result_size","_collada_mesh_parser_get_error_ptr","_collada_mesh_parser_get_error_size","_collada_mesh_parser_get_last_timing_ms","_collada_mesh_parser_free_result"]'
  -s EXPORTED_RUNTIME_METHODS='["HEAPU8"]'
  -o "${DEST_DIR}/colladaMeshParser.js"
)

if [[ "${EMSCRIPTEN_ENABLE_SIMD}" == "1" ]]; then
  COMMON_FLAGS+=(-msimd128)
fi

if [[ "${BUILD_VARIANT}" == "debug" ]]; then
  emcc -O0 -g3 -s ASSERTIONS=2 "${COMMON_FLAGS[@]}"
else
  emcc "${EMSCRIPTEN_OPT_LEVEL}" -flto -s ASSERTIONS=0 "${COMMON_FLAGS[@]}"
fi

echo "Built Collada mesh parser WASM:"
echo "  ${DEST_DIR}/colladaMeshParser.js"
echo "  ${DEST_DIR}/colladaMeshParser.wasm"
