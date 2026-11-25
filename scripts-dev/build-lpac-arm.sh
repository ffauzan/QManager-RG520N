#!/bin/sh
# Build the lpac binary bundled as scripts/usr/bin/qmanager_lpac.
#
# lpac v2.2.1 builds its drivers into the executable, so one ARMv7 binary is
# enough. The local patch adds AT_USE_QCMD=1: QManager's qcmd broker owns
# /dev/smd11, and opening that serial device directly would bypass its lock.
#
# Requires Docker with linux/arm/v7 support. Run from the repo root:
#   sh scripts-dev/build-lpac-arm.sh

set -eu

ROOT=$(CDPATH= cd -- "$(dirname "$0")/.." && pwd)
SRC=${LPAC_SRC:-/tmp/lpac-src}
PATCH="$ROOT/scripts-dev/lpac-qcmd-at.patch"
OUT="$ROOT/scripts/usr/bin/qmanager_lpac"

if [ ! -d "$SRC" ]; then
    git clone --depth 1 --branch v2.2.1 \
        https://github.com/estkme-group/lpac.git "$SRC"
fi

cd "$SRC"
git checkout v2.2.1
git reset --hard v2.2.1
git apply "$PATCH"

docker run --rm --platform linux/arm/v7 \
    -v "$SRC:/src" -w /src arm32v7/debian:bullseye bash -lc '
set -e
cat > /etc/apt/sources.list <<EOF
deb http://snapshot.debian.org/archive/debian/20261101T000000Z bullseye main
deb http://archive.debian.org/debian-security bullseye-security main
EOF
apt-get -o Acquire::Check-Valid-Until=false update >/dev/null 2>&1
DEBIAN_FRONTEND=noninteractive apt-get install -y --no-install-recommends \
    build-essential cmake libcurl4-openssl-dev libssl-dev >/dev/null 2>&1
rm -rf build
cmake -B build \
    -DLPAC_WITH_APDU_PCSC=OFF \
    -DLPAC_WITH_APDU_AT=ON \
    -DLPAC_WITH_HTTP_CURL=ON \
    -DLPAC_DYNAMIC_LIBEUICC=OFF \
    -DLPAC_DYNAMIC_DRIVERS=OFF \
    -DCMAKE_BUILD_TYPE=Release >/dev/null
cmake --build build -j2 >/dev/null
'

install -m 755 "$SRC/build/output/lpac" "$OUT"
echo "installed $OUT"
