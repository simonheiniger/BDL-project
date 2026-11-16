// Minimaler Geohash-Encoder (https://en.wikipedia.org/wiki/Geohash).
// Geohash = Z-Order-Kurve: abwechselnd Laengen-/Breitengrad halbieren, 5 Bit -> 1 Base32-Zeichen.
// Gemeinsames Praefix = gleiche Zelle. 6 Zeichen ~ 1.2 km x 0.6 km.
const BASE32 = "0123456789bcdefghjkmnpqrstuvwxyz";

export function encodeGeohash(lat, lon, precision = 6) {
  let latR = [-90, 90];
  let lonR = [-180, 180];
  let hash = "";
  let bits = 0;
  let ch = 0;
  let even = true;
  while (hash.length < precision) {
    const r = even ? lonR : latR;
    const v = even ? lon : lat;
    const mid = (r[0] + r[1]) / 2;
    ch <<= 1;
    if (v >= mid) {
      ch |= 1;
      r[0] = mid;
    } else {
      r[1] = mid;
    }
    even = !even;
    if (++bits === 5) {
      hash += BASE32[ch];
      bits = 0;
      ch = 0;
    }
  }
  return hash;
}
