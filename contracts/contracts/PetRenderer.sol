// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Strings} from "@openzeppelin/contracts/utils/Strings.sol";
import {Base64} from "@openzeppelin/contracts/utils/Base64.sol";
import {Pet} from "./lib/PetTypes.sol";
import {PetDecor} from "./PetDecor.sol";
import {SpriteBodies} from "./pixel/SpriteBodies.sol";
import {SpriteExtras} from "./pixel/SpriteExtras.sol";

/// @title PetRenderer – Pixel-Art (32x32, Retro) komplett on-chain aus der DNA
/// @notice Ebenen: Fluegel-Cosmetic -> Ohren -> Schwanz -> Koerper -> Muster -> Mund/Augen -> Cosmetic -> (Eierschale).
///         Alle Arten teilen dieselben Anker (Kopf, Augen, Mund) -> Mischlinge und Cosmetics passen pixelgenau.
///         Die App zeigt genau dieses Bild an; es gibt nur eine Darstellung.
/// @dev Sprite-Daten (4 Bit/Pixel) liegen in SpriteBodies/SpriteExtras (generiert von art/build-sprites.mjs).
///      DNA-Layout: 8 Gene a 16 Bit: 0 Farbe, 1 Spezies, 2 Ohren, 3 Augen, 4 Mund, 5 Muster, 6 Hintergrund, 7 Schwanz.
contract PetRenderer {
    using Strings for uint256;

    struct Look {
        uint8 palette;
        uint8 species;
        uint8 ears;
        uint8 tail;
        uint8 eyes;
        uint8 mouth;
        uint8 pattern;
        uint8 bg;
        uint8 tier; // 0 Common, 1 Rare, 2 Epic, 3 Legendary
        uint8 stage; // 0 Ei, 1 Baby, 2 Erwachsen, 3 Legendaer
    }

    string private constant SPECIES =
        "Katze|Fuchs|Hase|Baer|Frosch|Drache|Giraffe|Elefant|Nashorn|Krokodil|Pinguin|Eule|Schildkroete|Loewe|Wolf";

    PetDecor public immutable decor;
    SpriteBodies public immutable bodies;
    SpriteExtras public immutable extras;

    constructor(PetDecor decor_, SpriteBodies bodies_, SpriteExtras extras_) {
        decor = decor_;
        bodies = bodies_;
        extras = extras_;
    }

    // ------------------------------------------------------------------ Gene -> Traits

    function gene(uint256 dna, uint256 slot) internal pure returns (uint256) {
        return (dna >> (16 * slot)) & 0xffff;
    }

    /// @notice Spezies aus einem Gen (15 Arten). Haeufig: Katze/Fuchs/Hase je 9 %; selten: Giraffe,
    ///         Nashorn, Krokodil je 5 %; Drache 4 %. Bytes = kumulierte Prozent-Grenzen.
    function speciesOf(uint256 g) public pure returns (uint8 i) {
        bytes15 cum = hex"09121b232a2e33393e434b52585e64";
        uint256 r = g % 100;
        while (r >= uint8(cum[i])) ++i;
    }

    /// @notice Traits aus DNA. Gewichtete Wuerfe -> seltene Varianten.
    function look(uint256 dna, uint256 level) public pure returns (Look memory l) {
        uint256 r = gene(dna, 0) % 100; // Farbe: 80 % gewoehnlich, 12 % selten, 6 % Galaxie, 2 % Gold
        l.palette = r < 80 ? uint8(r % 6) : r < 92 ? uint8(6 + (r % 2)) : r < 98 ? 8 : 9;
        l.species = speciesOf(gene(dna, 1));
        l.ears = speciesOf(gene(dna, 2));
        l.tail = speciesOf(gene(dna, 7));
        r = gene(dna, 3) % 100;
        l.eyes = r < 30 ? 0 : r < 50 ? 1 : r < 65 ? 2 : r < 80 ? 3 : r < 92 ? 4 : 5;
        l.mouth = uint8(gene(dna, 4) % 4);
        r = gene(dna, 5) % 100;
        l.pattern = r < 35 ? 0 : r < 55 ? 1 : r < 72 ? 2 : r < 88 ? 3 : 4;
        l.bg = uint8(gene(dna, 6) % 6);

        // Seltenheit = Summe der Trait-Punkte; Mischlinge (nur durch Fusion) bekommen Bonus
        uint256 pts = l.palette == 9 ? 6 : l.palette == 8 ? 4 : l.palette >= 6 ? 2 : 0;
        pts += l.eyes == 5 ? 2 : l.eyes == 4 ? 1 : 0;
        uint8 s = l.species;
        pts += s == 5 ? 3 : (s == 6 || s == 8 || s == 9) ? 2 : (s == 4 || s == 7 || s == 13 || s == 14) ? 1 : 0;
        pts += l.pattern == 4 ? 1 : 0;
        pts += (l.ears != l.species ? 1 : 0) + (l.tail != l.species ? 1 : 0);
        l.tier = pts >= 6 ? 3 : pts >= 4 ? 2 : pts >= 2 ? 1 : 0;

        l.stage = level <= 1 ? 0 : level < 5 ? 1 : level < 15 ? 2 : 3;
    }

    // ------------------------------------------------------------------ Metadaten

    function tokenURI(uint256 id, Pet memory p, uint256 itemId, string memory itemName)
        external
        view
        returns (string memory)
    {
        Look memory l = look(p.dna, p.level);
        string memory json = string.concat(
            '{"name":"',
            _paletteName(l.palette),
            "-",
            _pick(l.species, SPECIES),
            " #",
            id.toString(),
            '","description":"Phygitales Web3-Tamagotchi (ZHAW BDL HS26). Bild und Traits on-chain generiert.",',
            '"image":"data:image/svg+xml;base64,',
            Base64.encode(bytes(svg(p, itemId))),
            '","attributes":',
            _attributes(p, l, itemName),
            "}"
        );
        return string.concat("data:application/json;base64,", Base64.encode(bytes(json)));
    }

    function _attributes(Pet memory p, Look memory l, string memory itemName) internal pure returns (string memory) {
        string memory a = string.concat(
            _attr("Seltenheit", _pick(l.tier, "Common|Rare|Epic|Legendary")),
            _attr("Stufe", _pick(l.stage, "Ei|Baby|Erwachsen|Legendaer")),
            _attr("Spezies", _pick(l.species, SPECIES)),
            _attr("Ohren", _pick(l.ears, SPECIES)),
            _attr("Schwanz", _pick(l.tail, SPECIES)),
            _attr("Rasse", l.ears == l.species && l.tail == l.species ? "Reinrassig" : "Mischling"),
            _attr("Farbe", _paletteName(l.palette)),
            _attr("Augen", _pick(l.eyes, "Kulleraugen|Schlaefrig|Zwinkernd|Funkelnd|Herzaugen|Sternenaugen")),
            _attr("Mund", _pick(l.mouth, "Laecheln|Katzenmund|Staunend|Zunge"))
        );
        a = string.concat(
            a,
            _attr("Muster", _pick(l.pattern, "Keins|Bauch|Punkte|Tigerstreifen|Herz")),
            _attr("Hintergrund", _pick(l.bg, "Sonnenuntergang|Minzwiese|Sternennacht|Zuckerwatte|Ozean|Creme")),
            _attr("Cosmetic", bytes(itemName).length > 0 ? itemName : "Keins"),
            _num("Level", p.level),
            _num("Generation", p.generation),
            _num("STR", p.stats[0]),
            _num("AGI", p.stats[1]),
            _num("INT", p.stats[2]),
            _num("VIT", p.stats[3])
        );
        // letztes Komma entfernen
        bytes memory b = bytes(a);
        assembly {
            mstore(b, sub(mload(b), 1))
        }
        return string.concat("[", string(b), "]");
    }

    function _attr(string memory k, string memory v) internal pure returns (string memory) {
        return string.concat('{"trait_type":"', k, '","value":"', v, '"},');
    }

    function _num(string memory k, uint256 v) internal pure returns (string memory) {
        return string.concat('{"trait_type":"', k, '","value":', v.toString(), "},");
    }

    /// @dev i-tes Element einer "|"-getrennten Liste (spart viele String-Arrays im Bytecode)
    function _pick(uint256 i, string memory list) internal pure returns (string memory) {
        bytes memory b = bytes(list);
        uint256 start;
        uint256 n;
        for (uint256 j = 0; j <= b.length; ++j) {
            if (j == b.length || b[j] == "|") {
                if (n == i) {
                    bytes memory out = new bytes(j - start);
                    for (uint256 k = 0; k < out.length; ++k) {
                        out[k] = b[start + k];
                    }
                    return string(out);
                }
                ++n;
                start = j + 1;
            }
        }
        return "";
    }

    function _paletteName(uint8 i) internal pure returns (string memory) {
        return _pick(i, "Karamell|Schiefer|Pfirsich|Minze|Lavendel|Himmel|Lagune|Lava|Galaxie|Gold");
    }

    /// @return main, light, dark
    function _palette(uint8 i) internal pure returns (string memory, string memory, string memory) {
        return (
            _pick(i, "#e0a46e|#a9b0c8|#ffad85|#7fe0c0|#b9a3ff|#86c5ff|#4fd1c5|#ff6b4a|#6a4cff|#f6c344"),
            _pick(i, "#fbe6cf|#eceff8|#ffe3d3|#dcfff3|#efe9ff|#e4f3ff|#c9fff9|#ffd2b8|#c7b8ff|#fff4c9"),
            _pick(i, "#94592c|#5b6180|#c8664a|#2f9c7c|#6e55c9|#3f82cc|#2c6e8f|#9e2a1c|#24185e|#a87b00")
        );
    }

    // ------------------------------------------------------------------ SVG (Pixel-Art)

    /// @dev Augen-Muster 3x3 (Farbindex je Pixel, 0 = durchsichtig): rund, schlaefrig, zwinkernd, funkelnd, Herz, Stern
    bytes private constant EYES =
        hex"080805080808080808" hex"000000080808000000" hex"000800080008000000" hex"080b050b0b0b080b08"
        hex"060006060606000600" hex"000700070707070007";

    struct Buf {
        bytes b;
        uint256 n;
    }

    function svg(Pet memory p, uint256 itemId) public view returns (string memory) {
        Look memory l = look(p.dna, p.level);
        uint256 dy = l.stage == 0 ? 7 : 0; // Ei: Baby sitzt tiefer, schaut aus der Schale
        bytes memory c = new bytes(1024);

        if (itemId == 5) _blit(c, extras.cosmetic(5), 0, 0, 32, 32, dy);
        _blit(c, bodies.ears(l.ears), 0, 0, 32, 20, dy);
        _blit(c, bodies.tail(l.tail), 20, 13, 12, 16, dy);
        _blit(c, bodies.body(l.species), 0, 0, 32, 32, dy);
        _pattern(c, l.pattern, dy);
        if (!_noMouth(l.species)) _mouth(c, l.mouth, dy);
        _blush(c, dy);
        bool bump = l.ears == 4 || l.ears == 9;
        _eyes(c, l.eyes, bump, dy);
        if (itemId >= 1 && itemId <= 4) _blit(c, extras.cosmetic(itemId), 0, 0, 32, 32, dy);
        if (l.stage == 0) _blit(c, extras.shell(), 0, 21, 32, 14, 0); // Augen bleiben ueber dem Schalenrand

        Buf memory o = Buf(new bytes(48_000), 0);
        _w(o, '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 400 400" shape-rendering="crispEdges"><style>');
        _style(o, l.palette);
        _w(o, '</style><g transform="scale(12.5)">');
        _w(o, bytes(_background(l.bg)));
        _w(o, '<rect x="9" y="29" width="14" height="1" fill="#000" opacity=".18"/>');
        if (l.stage == 3) {
            _w(o, '<g><animate attributeName="opacity" values="1;.3" dur=".8s" calcMode="discrete" repeatCount="indefinite"/>');
            _emit(o, extras.aura(), 1);
            _w(o, "</g>");
        }
        if (l.stage == 1) _w(o, '<g transform="translate(4 8) scale(.75)">');
        else _w(o, "<g>");
        _w(
            o,
            bytes(
                l.stage == 0
                    ? '<g><animateTransform attributeName="transform" type="translate" values="0 0;1 0;0 0;-1 0" dur="1.6s" calcMode="discrete" repeatCount="indefinite"/>'
                    : '<g><animateTransform attributeName="transform" type="translate" values="0 0;0 1" dur="1.2s" calcMode="discrete" repeatCount="indefinite"/>'
            )
        );
        _emit(o, c, 1);
        if (itemId != 2 && l.eyes != 1 && l.eyes != 2) _blink(o, bump, dy);
        _w(o, "</g></g></g>");
        if (l.stage == 3 || l.palette == 9) _w(o, bytes(decor.sparkles()));
        _w(o, bytes(decor.frame(l.tier)));
        _w(o, "</svg>");
        bytes memory out = o.b;
        uint256 n = o.n;
        assembly {
            mstore(out, n)
        }
        return string(out);
    }

    /// @dev Sprite (4 Bit/Pixel, Zeile fuer Zeile) auf die 32x32-Leinwand; 0 = durchsichtig
    function _blit(bytes memory c, bytes memory d, uint256 x0, uint256 y0, uint256 w, uint256 h, uint256 dy) internal pure {
        if (d.length == 0) return;
        for (uint256 r = 0; r < h; ++r) {
            uint256 y = y0 + r + dy;
            if (y > 31) break;
            for (uint256 col = 0; col < w; ++col) {
                uint256 i = r * w + col;
                uint8 v = uint8(d[i >> 1]);
                v = i & 1 == 0 ? v >> 4 : v & 15;
                if (v != 0) c[(y << 5) + x0 + col] = bytes1(v);
            }
        }
    }

    /// @dev Muster nur auf Fell-Pixeln (Index 2): Bauch, Punkte, Streifen, Herz
    function _pattern(bytes memory c, uint8 pt, uint256 dy) internal pure {
        if (pt == 0) return;
        if (pt == 4) {
            _stamp(c, 14, 22 + dy, hex"060006060606000600", 3);
            return;
        }
        for (uint256 y = 7; y < 30; ++y) {
            for (uint256 x = 6; x < 26; ++x) {
                uint256 i = ((y + dy) << 5) + x;
                if (y + dy > 31 || c[i] != 0x02) continue;
                if (pt == 1) {
                    uint256 ddx = x > 15 ? x - 15 : 15 - x;
                    if (y >= 21 && y <= 27 && ddx <= 4) c[i] = 0x03;
                } else if (pt == 2) {
                    if ((x * 7 + y * 5) % 11 == 0) c[i] = 0x04;
                } else if (pt == 3) {
                    if ((y <= 10 && x % 3 == 1) || (y >= 20 && (x + y) % 4 == 0 && (x < 14 || x > 17))) c[i] = 0x04;
                }
            }
        }
    }

    function _mouth(bytes memory c, uint8 m, uint256 dy) internal pure {
        if (m == 0) _stamp(c, 14, 16 + dy, hex"0800000800080800", 4);
        else if (m == 1) _stamp(c, 13, 16 + dy, hex"080008080008000800000800", 6);
        else if (m == 2) _stamp(c, 14, 16 + dy, hex"000808000806060800080800", 4);
        else _stamp(c, 14, 16 + dy, hex"0808080800060600", 4);
    }

    function _blush(bytes memory c, uint256 dy) internal pure {
        for (uint256 k = 0; k < 4; ++k) {
            uint256 x = k < 2 ? 9 + k : 19 + k; // 9,10 und 21,22
            uint256 i = ((15 + dy) << 5) + x;
            uint8 v = uint8(c[i]);
            if (v >= 2 && v <= 5) c[i] = 0x06;
        }
    }

    function _eyes(bytes memory c, uint8 e, bool bump, uint256 dy) internal pure {
        uint256 y = (bump ? 6 : 11) + dy;
        bytes memory pat = new bytes(9);
        for (uint256 side = 0; side < 2; ++side) {
            uint256 kind = e == 2 && side == 1 ? 2 : e == 2 ? 0 : e;
            for (uint256 i = 0; i < 9; ++i) pat[i] = EYES[kind * 9 + i];
            _stamp(c, side == 0 ? (bump ? 10 : 11) : (bump ? 19 : 18), y, pat, 3);
        }
    }

    /// @dev Blinzeln: alle ~4 s kurz Lider (Fell + Strich) ueber die Augen
    function _blink(Buf memory o, bool bump, uint256 dy) internal pure {
        string memory y = (bump ? 6 + dy : 11 + dy).toString();
        string memory y1 = (bump ? 7 + dy : 12 + dy).toString();
        _w(o, '<g opacity="0"><animate attributeName="opacity" values="0;1;0" keyTimes="0;.94;.98" dur="4s" calcMode="discrete" repeatCount="indefinite"/>');
        for (uint256 side = 0; side < 2; ++side) {
            string memory x = uint256(side == 0 ? (bump ? 10 : 11) : (bump ? 19 : 18)).toString();
            _w(o, bytes(string.concat('<rect x="', x, '" y="', y, '" width="3" height="3" class="c2"/><rect x="', x, '" y="', y1, '" width="3" height="1" class="c8"/>')));
        }
        _w(o, "</g>");
    }

    function _stamp(bytes memory c, uint256 x0, uint256 y0, bytes memory pat, uint256 w) internal pure {
        for (uint256 i = 0; i < pat.length; ++i) {
            if (pat[i] == 0) continue;
            uint256 y = y0 + i / w;
            if (y > 31) continue;
            c[(y << 5) + x0 + (i % w)] = pat[i];
        }
    }

    /// @dev Leinwand -> <rect>-Laeufe (gleichfarbige Pixel einer Zeile zusammengefasst)
    function _emit(Buf memory o, bytes memory c, uint256 minV) internal pure {
        if (c.length < 1024) {
            // Sprite im 4-Bit-Format (Aura): erst entpacken
            bytes memory full = new bytes(1024);
            _blit(full, c, 0, 0, 32, 32, 0);
            c = full;
        }
        for (uint256 y = 0; y < 32; ++y) {
            uint256 x = 0;
            while (x < 32) {
                uint8 v = uint8(c[(y << 5) + x]);
                if (v < minV) {
                    ++x;
                    continue;
                }
                uint256 run = 1;
                while (x + run < 32 && uint8(c[(y << 5) + x + run]) == v) ++run;
                _w(o, '<rect x="');
                _w(o, _n(x));
                _w(o, '" y="');
                _w(o, _n(y));
                _w(o, '" width="');
                _w(o, _n(run));
                _w(o, '" height="1" class="c');
                _w(o, _n(v));
                _w(o, '"/>');
                x += run;
            }
        }
    }

    function _style(Buf memory o, uint8 pal) internal pure {
        (string memory main, string memory light, string memory dark) = _palette(pal);
        _w(
            o,
            bytes(
                string.concat(
                    ".c1{fill:#231b2e}.c2{fill:",
                    main,
                    "}.c3{fill:",
                    light,
                    "}.c4{fill:",
                    dark,
                    "}.c5{fill:#fff8ee}.c6{fill:#ff8fb1}.c7{fill:#ffc93c}.c8{fill:#1a1220}.c9{fill:#e23d4f}"
                    ".c10{fill:#5cc45a}.c11{fill:#5fd8ff}.c12{fill:#c9ced8}.c13{fill:#7a4b2a}.c14{fill:#f28c28}"
                )
            )
        );
    }

    /// @dev Retro-Hintergrund: Himmel, Boden, ein paar Deko-Pixel
    function _background(uint8 b) internal pure returns (string memory) {
        string memory deco = b == 0
            ? '<rect x="23" y="3" width="5" height="5" fill="#ffe7a0"/><rect x="22" y="4" width="7" height="3" fill="#ffe7a0"/>'
            : b == 1
                ? '<g fill="#4fa35e"><rect x="3" y="28" width="1" height="1"/><rect x="5" y="27" width="1" height="2"/><rect x="26" y="28" width="1" height="1"/><rect x="28" y="27" width="1" height="2"/></g>'
                : b == 2
                    ? '<g fill="#fff"><rect x="3" y="3" width="1" height="1"/><rect x="9" y="5" width="1" height="1"/><rect x="27" y="2" width="1" height="1"/><rect x="24" y="8" width="1" height="1"/><rect x="5" y="12" width="1" height="1"/><rect x="29" y="14" width="1" height="1"/></g><rect x="23" y="3" width="4" height="4" fill="#fff6c7"/><rect x="25" y="2" width="3" height="4" fill="#1d2150"/>'
                    : b == 3
                        ? '<g fill="#fff"><rect x="2" y="4" width="6" height="2"/><rect x="3" y="3" width="3" height="1"/><rect x="23" y="7" width="7" height="2"/><rect x="25" y="6" width="3" height="1"/></g>'
                        : b == 4
                            ? '<g fill="#e6f7ff"><rect x="4" y="10" width="1" height="1"/><rect x="5" y="6" width="1" height="1"/><rect x="27" y="9" width="1" height="1"/><rect x="26" y="4" width="2" height="2"/></g>'
                            : '<g><rect x="4" y="5" width="1" height="1" fill="#ff8fb1"/><rect x="27" y="7" width="1" height="1" fill="#86c5ff"/><rect x="6" y="20" width="1" height="1" fill="#ffc93c"/><rect x="25" y="18" width="1" height="1" fill="#7fe0c0"/></g>';
        return string.concat(
            '<rect width="32" height="32" fill="',
            _pick(b, "#ffb48a|#c8f2dc|#1d2150|#ffd6ec|#9fdcff|#fff1d6"),
            '"/><rect y="29" width="32" height="3" fill="',
            _pick(b, "#c97b5a|#6cc47a|#3a3f7a|#e6b3e6|#3f8fd0|#e6c99a"),
            '"/>',
            deco
        );
    }

    /// @dev Frosch (Breitmaul), Elefant (Ruessel), Krokodil (Zaehne), Eule (Schnabel) zeichnen ihr Maul selbst
    function _noMouth(uint8 s) internal pure returns (bool) {
        return s == 4 || s == 7 || s == 9 || s == 11;
    }

    /// @dev An den Puffer anhaengen, in 32-Byte-Woertern (statt Byte fuer Byte -> ~10x weniger Gas).
    ///      Kann bis zu 31 Byte ueber das Ende hinaus schreiben -> Reserve im Puffer pruefen.
    function _w(Buf memory o, bytes memory s) internal pure {
        bytes memory b = o.b;
        uint256 n = o.n;
        uint256 len = s.length;
        require(n + len + 32 <= b.length, "svg buffer");
        assembly {
            let dst := add(add(b, 32), n)
            let src := add(s, 32)
            for { let i := 0 } lt(i, len) { i := add(i, 32) } {
                mstore(add(dst, i), mload(add(src, i)))
            }
        }
        o.n = n + len;
    }

    /// @dev Zahl 0..99 als ASCII (guenstiger als Strings.toString fuer die vielen Pixel-Koordinaten)
    function _n(uint256 v) internal pure returns (bytes memory r) {
        if (v < 10) {
            r = new bytes(1);
            r[0] = bytes1(uint8(48 + v));
        } else {
            r = new bytes(2);
            r[0] = bytes1(uint8(48 + v / 10));
            r[1] = bytes1(uint8(48 + (v % 10)));
        }
    }
}
