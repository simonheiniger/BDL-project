// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Strings} from "@openzeppelin/contracts/utils/Strings.sol";
import {Base64} from "@openzeppelin/contracts/utils/Base64.sol";
import {Pet} from "./lib/PetTypes.sol";
import {PetDecor} from "./PetDecor.sol";
import {PetAnatomy} from "./PetAnatomy.sol";

/// @title PetRenderer – generiert Bild (SVG) und Metadaten eines Pets komplett on-chain
/// @notice Aussehen = f(DNA, Level, Generation, angezogenes Cosmetic). Kein IPFS, kein Server:
///         solange die Chain existiert, existiert das Bild.
/// @dev Aufgeteilt auf PetRenderer + PetAnatomy + PetDecor wegen 24-KB-Limit pro Contract (EIP-170).
///      DNA-Layout: 8 Gene a 16 Bit (Slot k = Bits 16k..16k+15):
///      0 Farbe, 1 Spezies (Kopf/Koerper/Schnauze), 2 Ohren, 3 Augen, 4 Mund, 5 Muster, 6 Hintergrund, 7 Schwanz.
///      Beim Mint sind Slot 1, 2 und 7 identisch (reinrassig); Fusion mischt slotweise -> Mischlinge.
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
    string private constant BODY = '<ellipse cx="200" cy="300" rx="80" ry="60"/>';

    PetDecor public immutable decor;
    PetAnatomy public immutable anatomy;

    constructor(PetDecor decor_, PetAnatomy anatomy_) {
        decor = decor_;
        anatomy = anatomy_;
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

    // ------------------------------------------------------------------ SVG

    function svg(Pet memory p, uint256 itemId) public view returns (string memory) {
        Look memory l = look(p.dna, p.level);
        (string memory main, string memory light, string memory dark) = _palette(l.palette);
        string memory headShape = l.stage == 0 ? _egg() : anatomy.head(l.species);

        string memory out = string.concat(
            '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 400 400"><defs>',
            decor.bgGradient(l.bg),
            '<radialGradient id="b" cx="160" cy="150" r="240" gradientUnits="userSpaceOnUse"><stop offset="0" stop-color="',
            light,
            '"/><stop offset=".5" stop-color="',
            main,
            '"/><stop offset="1" stop-color="',
            dark,
            '"/></radialGradient><radialGradient id="au"><stop offset=".45" stop-color="',
            main,
            '" stop-opacity=".95"/><stop offset=".7" stop-color="#fff" stop-opacity=".6"/><stop offset="1" stop-color="',
            light,
            '" stop-opacity="0"/></radialGradient><clipPath id="c">',
            headShape,
            l.stage == 0 ? "" : BODY,
            "</clipPath></defs>",
            '<rect width="400" height="400" fill="url(#bg)"/>',
            decor.bgDecor(l.bg)
        );
        if (l.stage == 3) {
            out = string.concat(
                out,
                '<circle cx="200" cy="225" r="165" fill="url(#au)"><animate attributeName="r" values="150;178;150" dur="3s" repeatCount="indefinite"/></circle><g stroke="#fff" stroke-width="6" stroke-linecap="round" opacity=".7"><path d="M200 30V60M200 390V370M30 225H60M370 225H340M80 105L101 126M320 105L299 126"/><animateTransform attributeName="transform" type="rotate" values="0 200 225;360 200 225" dur="24s" repeatCount="indefinite"/></g>'
            );
        }
        out = string.concat(
            out,
            '<ellipse cx="200" cy="362" rx="110" ry="13" fill="#000" opacity=".15"/>',
            '<g><animateTransform attributeName="transform" type="translate" values="0 0;0 -6;0 0" dur="3s" repeatCount="indefinite"/>',
            l.stage == 0 ? _eggBody(headShape, dark) : _creature(p, l, headShape, main, light, dark, itemId),
            "</g>"
        );
        if (l.stage == 3 || l.palette == 9) out = string.concat(out, decor.sparkles());
        return string.concat(out, decor.frame(l.tier), "</svg>");
    }

    /// @dev Zeichenreihenfolge: Fluegel, Schwanz, Koerper, Ohren, Kopf, Muster, Pfoten, Gesicht, Accessoires
    function _creature(
        Pet memory p,
        Look memory l,
        string memory headShape,
        string memory main,
        string memory light,
        string memory dark,
        uint256 itemId
    ) internal view returns (string memory) {
        string memory fill = string.concat('<g fill="url(#b)" stroke="', dark, '" stroke-width="5" stroke-linejoin="round">');
        string memory g = string.concat(
            l.stage == 1 ? '<g transform="translate(200 362) scale(.8) translate(-200 -362)">' : "<g>",
            itemId == 5 ? decor.wings() : "",
            anatomy.tail(l.tail, main, dark),
            fill,
            BODY,
            "</g>",
            anatomy.back(l.species, dark),
            anatomy.ears(l.ears, dark),
            fill,
            headShape,
            '</g><g clip-path="url(#c)">',
            _pattern(l.pattern, dark),
            l.palette == 8 ? _galaxySpeckles() : "",
            "</g>",
            fill,
            '<ellipse cx="168" cy="350" rx="22" ry="14"/><ellipse cx="232" cy="350" rx="22" ry="14"/></g>'
        );
        return string.concat(
            g,
            '<ellipse cx="148" cy="130" rx="32" ry="17" fill="#fff" opacity=".45" transform="rotate(-30 148 130)"/>',
            anatomy.snout(l.species, light, dark),
            l.ears == 4 || l.ears == 9 ? string.concat('<g transform="translate(0 -60)">', _eyes(l.eyes), "</g>") : _eyes(l.eyes),
            '<g fill="#ff7aa2" opacity=".5"><ellipse cx="126" cy="222" rx="17" ry="10"/><ellipse cx="274" cy="222" rx="17" ry="10"/></g>',
            _noMouth(l.species) ? "" : _mouth(l.mouth),
            p.generation > 1 ? _gem() : "",
            itemId != 5 ? decor.cosmetic(itemId) : "",
            "</g>"
        );
    }

    /// @dev Frosch (breites Maul), Elefant (Ruessel), Krokodil (Zaehne), Pinguin/Eule (Schnabel)
    function _noMouth(uint8 s) internal pure returns (bool) {
        return s == 4 || s == 7 || s == 9 || s == 10 || s == 11;
    }

    function _egg() internal pure returns (string memory) {
        return '<path d="M200 118C262 118 300 210 300 268C300 320 255 345 200 345C145 345 100 320 100 268C100 210 138 118 200 118Z"/>';
    }

    function _eggBody(string memory shape, string memory dark) internal pure returns (string memory) {
        return string.concat(
            '<g><animateTransform attributeName="transform" type="rotate" values="-4 200 345;4 200 345;-4 200 345" dur="2s" repeatCount="indefinite"/>',
            '<g fill="url(#b)" stroke="',
            dark,
            '" stroke-width="5">',
            shape,
            '</g><g clip-path="url(#c)" fill="#fff" opacity=".55"><circle cx="150" cy="190" r="16"/><circle cx="245" cy="170" r="11"/><circle cx="265" cy="300" r="18"/><circle cx="135" cy="305" r="12"/></g>',
            '<path d="M128 250L152 236L172 256L196 236L220 258L244 238L272 252" fill="none" stroke="',
            dark,
            '" stroke-width="5" stroke-linejoin="round"/>',
            '<g fill="#2b2340"><circle cx="178" cy="218" r="8"/><circle cx="222" cy="218" r="8"/></g>',
            '<ellipse cx="155" cy="170" rx="22" ry="13" fill="#fff" opacity=".5" transform="rotate(-35 155 170)"/></g>'
        );
    }

    function _eyes(uint8 e) internal pure returns (string memory) {
        if (e == 1) {
            return '<path d="M142 192Q160 206 178 192M222 192Q240 206 258 192" fill="none" stroke="#2b2340" stroke-width="6" stroke-linecap="round"/>';
        }
        if (e == 2) {
            return string.concat(
                _roundEye("160"),
                '<path d="M222 194Q240 178 258 194" fill="none" stroke="#2b2340" stroke-width="6" stroke-linecap="round"/>'
            );
        }
        if (e == 3) return string.concat(_sparkleEye("160"), _sparkleEye("240"));
        if (e == 4) {
            return '<g fill="#ff4d7d" stroke="#2b2340" stroke-width="3"><path d="M160 184C160 172 142 172 142 184C142 194 156 200 160 208C164 200 178 194 178 184C178 172 160 172 160 184Z"/><path d="M240 184C240 172 222 172 222 184C222 194 236 200 240 208C244 200 258 194 258 184C258 172 240 172 240 184Z"/></g>';
        }
        if (e == 5) return string.concat(_star("160"), _star("240"));
        return string.concat(_roundEye("160"), _roundEye("240"));
    }

    function _roundEye(string memory x) internal pure returns (string memory) {
        return string.concat(
            '<g transform="translate(',
            x,
            ' 190)"><circle r="17" fill="#2b2340"/><circle cx="5" cy="-6" r="6" fill="#fff"/><circle cx="-5" cy="6" r="3" fill="#fff"/></g>'
        );
    }

    function _sparkleEye(string memory x) internal pure returns (string memory) {
        return string.concat(
            '<g transform="translate(',
            x,
            ' 190)"><ellipse rx="20" ry="25" fill="#2b2340"/><ellipse cy="9" rx="14" ry="12" fill="#6a4cff" opacity=".8"/><circle cx="6" cy="-9" r="8" fill="#fff"/><circle cx="-7" cy="8" r="4" fill="#fff"/></g>'
        );
    }

    function _star(string memory x) internal pure returns (string memory) {
        return string.concat(
            '<polygon transform="translate(',
            x,
            ' 190)" points="0,-20 5.9,-8.1 19,-6.2 9.5,3.1 11.8,16.2 0,10 -11.8,16.2 -9.5,3.1 -19,-6.2 -5.9,-8.1" fill="#ffd23f" stroke="#b8860b" stroke-width="3" stroke-linejoin="round"/>'
        );
    }

    function _mouth(uint8 m) internal pure returns (string memory) {
        if (m == 1) return '<path d="M184 222Q192 233 200 222Q208 233 216 222" fill="none" stroke="#2b2340" stroke-width="4" stroke-linecap="round"/>';
        if (m == 2) return '<ellipse cx="200" cy="230" rx="9" ry="11" fill="#2b2340"/><ellipse cx="200" cy="236" rx="6" ry="4" fill="#ff7aa2"/>';
        if (m == 3) return '<path d="M188 222Q200 234 212 222" fill="none" stroke="#2b2340" stroke-width="4" stroke-linecap="round"/><path d="M195 229Q200 243 205 229Z" fill="#ff7aa2" stroke="#2b2340" stroke-width="2"/>';
        return '<path d="M188 222Q200 234 212 222" fill="none" stroke="#2b2340" stroke-width="4" stroke-linecap="round"/>';
    }

    function _pattern(uint8 pt, string memory dark) internal pure returns (string memory) {
        if (pt == 1) return '<ellipse cx="200" cy="322" rx="50" ry="36" fill="#fff" opacity=".6"/>';
        if (pt == 2) {
            return string.concat(
                '<g fill="',
                dark,
                '" opacity=".28"><circle cx="126" cy="150" r="14"/><circle cx="276" cy="160" r="10"/><circle cx="232" cy="118" r="8"/><circle cx="148" cy="300" r="11"/><circle cx="252" cy="310" r="13"/><circle cx="110" cy="200" r="7"/></g>'
            );
        }
        if (pt == 3) {
            return string.concat(
                '<path d="M200 98V134M176 102L182 130M224 102L218 130M124 286L148 292M122 310L146 312M276 286L252 292M278 310L254 312" stroke="',
                dark,
                '" stroke-width="9" stroke-linecap="round" opacity=".35"/>'
            );
        }
        if (pt == 4) {
            return '<path d="M200 310C200 296 178 296 178 310C178 324 196 332 200 342C204 332 222 324 222 310C222 296 200 296 200 310Z" fill="#ff4d7d" opacity=".85"/>';
        }
        return "";
    }

    function _galaxySpeckles() internal pure returns (string memory) {
        return '<g fill="#fff"><circle cx="130" cy="160" r="2.5"/><circle cx="280" cy="140" r="2"/><circle cx="250" cy="310" r="3"/><circle cx="160" cy="300" r="2"/><circle cx="290" cy="220" r="2.5"/><circle cx="112" cy="230" r="2"/><circle cx="215" cy="112" r="2"/></g>';
    }

    function _gem() internal pure returns (string memory) {
        return '<path d="M200 122L212 137L200 152L188 137Z" fill="#7df9ff" stroke="#2b2340" stroke-width="3"/><path d="M200 126L205 137L200 134Z" fill="#fff"/>';
    }
}
