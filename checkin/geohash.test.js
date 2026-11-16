import { test } from "node:test";
import assert from "node:assert/strict";
import { encodeGeohash } from "../app/api/_geohash.js";

test("bekannte Referenzwerte", () => {
  // Wikipedia-Beispiel: 57.64911, 10.40744 -> u4pruydqqvj
  assert.equal(encodeGeohash(57.64911, 10.40744, 11), "u4pruydqqvj");
});

test("ZHAW Winterthur (Technikumstrasse) liegt in u0qn", () => {
  assert.ok(encodeGeohash(47.4973, 8.7293, 6).startsWith("u0qn"));
});
