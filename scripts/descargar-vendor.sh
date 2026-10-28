#!/usr/bin/env bash
# ---------------------------------------------------------------------------
# Descarga las librerías de Cornerstone (legacy) a js/vendor/ para servirlas
# desde el mismo origen (los Web Workers NO pueden cargarse desde un CDN).
# Ejecutar desde la raíz del repo:   bash scripts/descargar-vendor.sh
# ---------------------------------------------------------------------------
set -euo pipefail

DEST="js/vendor"
CS_VERSION="2.6.1"
PARSER_VERSION="1.8.21"
LOADER_VERSION="4.13.2"

mkdir -p "$DEST"

descargar() {
  local url="$1" archivo="$2"
  echo "⬇️  $archivo"
  curl -fsSL "$url" -o "$DEST/$archivo"

  # Un 404 guardado como HTML pesa muy poco: lo detectamos.
  local bytes
  bytes=$(wc -c < "$DEST/$archivo")
  if [ "$bytes" -lt 10000 ]; then
    echo "❌ $archivo pesa solo $bytes bytes: la descarga falló." >&2
    exit 1
  fi
}

descargar "https://unpkg.com/cornerstone-core@${CS_VERSION}/dist/cornerstone.min.js" \
          "cornerstone.min.js"
descargar "https://unpkg.com/dicom-parser@${PARSER_VERSION}/dist/dicomParser.min.js" \
          "dicomParser.min.js"
# Build "NoWebWorkers": un solo archivo con todo incluido (códecs y dicomParser).
# Decodifica en el hilo principal, así que no necesita rutas de workers ni de códecs.
# (En la 4.13.2 ya no existen los archivos sueltos .min.js / WebWorker / Codecs.)
descargar "https://unpkg.com/cornerstone-wado-image-loader@${LOADER_VERSION}/dist/cornerstoneWADOImageLoaderNoWebWorkers.bundle.min.js" \
          "cornerstoneWADOImageLoaderNoWebWorkers.bundle.min.js"

echo
echo "✅ Listo. Archivos en $DEST:"
ls -lh "$DEST"
