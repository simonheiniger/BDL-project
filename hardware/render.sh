#!/usr/bin/env bash
# Exportiert pro Haus und pro Farbslot ein STL (out/) sowie die Gesamtplatte (out/plate_c1..c4.stl).
# out/plate.3mf = alle 5 Haeuser, 4 Farben in EINEM Druck (Teil -> Filament 1..4 = AMS-Slot 1..4), zentriert auf 256x256 (Bambu A1).
# out/house-N-*.3mf = einzelne Haeuser. STLs bleiben fuer andere Slicer.
set -euo pipefail
cd "$(dirname "$0")"
mkdir -p out
for f in house-1-huette house-2-bauernhaus house-3-cottage house-4-herrenhaus house-5-villa; do
  for c in 1 2 3 4; do openscad -q -D "part=$c" -o "out/${f}_c${c}.stl" "$f.scad"; done
done
for c in 1 2 3 4; do openscad -q -D "part=$c" -o "out/plate_c${c}.stl" all-houses.scad; done
for n in house-1-huette house-2-bauernhaus house-3-cottage house-4-herrenhaus house-5-villa plate; do python3 make3mf.py "$n"; done
echo "fertig: $(ls out/*.stl | wc -l) STL-Dateien in hardware/out/"
