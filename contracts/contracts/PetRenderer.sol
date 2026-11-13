// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Strings} from "@openzeppelin/contracts/utils/Strings.sol";
import {Base64} from "@openzeppelin/contracts/utils/Base64.sol";
import {Pet} from "./lib/PetTypes.sol";
import {PetDecor} from "./PetDecor.sol";

/// @title PetRenderer – generiert Bild (SVG) und Metadaten eines Pets komplett on-chain
/// @notice Aussehen = f(DNA, Level, Generation, angezogenes Cosmetic). Kein IPFS, kein Server:
///         solange die Chain existiert, existiert das Bild.
/// @dev Eigener Contract, weil der SVG-Code PetNFT ueber das 24-KB-Limit (EIP-170) heben wuerde.
///      DNA-Layout: 7 Gene a 16 Bit (Slot k = Bits 16k..16k+15). Fusion mischt slotweise.
contract PetRenderer {
    using Strings for uint256;

    struct Look {
        uint8 palette;
        uint8 shape;
        uint8 head;
        uint8 eyes;
        uint8 mouth;
        uint8 pattern;
        uint8 bg;
        uint8 tier; // 0 Common, 1 Rare, 2 Epic, 3 Legendary
        uint8 stage; // 0 Ei, 1 Baby, 2 Erwachsen, 3 Legendaer
    }

    string private constant INK = "#2b2340";

    PetDecor public immutable decor;

    constructor(PetDecor decor_) {
        decor = decor_;
    }

    // ------------------------------------------------------------------ Gene -> Traits

    function gene(uint256 dna, uint256 slot) internal pure returns (uint256) {
        return (dna >> (16 * slot)) & 0xffff;
    }

    /// @notice Traits aus DNA. Gewichtete Wuerfe -> seltene Varianten.
    function look(uint256 dna, uint256 level) public pure returns (Look memory l) {
        uint256 r = gene(dna, 0) % 100; // Palette: 80 % gewoehnlich, 12 % selten, 6 % Galaxie, 2 % Gold
        l.palette = r < 80 ? uint8(r % 6) : r < 92 ? uint8(6 + (r % 2)) : r < 98 ? 8 : 9;
        l.shape = uint8(gene(dna, 1) % 4);
        r = gene(dna, 2) % 100;
        l.head = r < 20 ? 0 : r < 40 ? 1 : r < 58 ? 2 : r < 73 ? 3 : r < 85 ? 4 : r < 95 ? 5 : 6;
        r = gene(dna, 3) % 100;
        l.eyes = r < 30 ? 0 : r < 50 ? 1 : r < 65 ? 2 : r < 80 ? 3 : r < 92 ? 4 : 5;
        l.mouth = uint8(gene(dna, 4) % 4);
        r = gene(dna, 5) % 100;
        l.pattern = r < 35 ? 0 : r < 55 ? 1 : r < 72 ? 2 : r < 88 ? 3 : 4;
        l.bg = uint8(gene(dna, 6) % 6);

        // Seltenheit = Summe der Trait-Punkte
        uint256 pts = l.palette == 9 ? 6 : l.palette == 8 ? 4 : l.palette >= 6 ? 2 : 0;
        pts += l.eyes == 5 ? 2 : l.eyes == 4 ? 1 : 0;
        pts += l.head == 6 ? 3 : l.head == 5 ? 1 : 0;
        pts += l.pattern == 4 ? 1 : 0;
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
            _pick(l.shape, "Mochi|Tropfen|Bohne|Birne"),
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
            _attr("Farbe", _paletteName(l.palette)),
            _attr("Form", _pick(l.shape, "Mochi|Tropfen|Bohne|Birne")),
            _attr("Kopf", _pick(l.head, "Keiner|Katzenohren|Hasenohren|Antennen|Spross|Hoerner|Heiligenschein")),
            _attr("Augen", _pick(l.eyes, "Kulleraugen|Schlaefrig|Zwinkernd|Funkelnd|Herzaugen|Sternenaugen")),
            _attr("Mund", _pick(l.mouth, "Laecheln|Katzenmund|Staunend|Zunge")),
            _attr("Muster", _pick(l.pattern, "Keins|Bauch|Punkte|Tigerstreifen|Herz")),
            _attr("Hintergrund", _pick(l.bg, "Sonnenuntergang|Minzwiese|Sternennacht|Zuckerwatte|Ozean|Creme"))
        );
        a = string.concat(
            a,
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
        return _pick(i, "Pfirsich|Minze|Lavendel|Himmel|Zitrone|Rosa|Lagune|Lava|Galaxie|Gold");
    }

    /// @return main, light, dark
    function _palette(uint8 i) internal pure returns (string memory, string memory, string memory) {
        return (
            _pick(i, "#ffad85|#7fe0c0|#b9a3ff|#86c5ff|#ffe066|#ff9cc6|#4fd1c5|#ff6b4a|#6a4cff|#f6c344"),
            _pick(i, "#ffe3d3|#dcfff3|#efe9ff|#e4f3ff|#fff8d1|#ffe4f0|#c9fff9|#ffd2b8|#c7b8ff|#fff4c9"),
            _pick(i, "#c8664a|#2f9c7c|#6e55c9|#3f82cc|#c9a000|#cc5a8e|#2c6e8f|#9e2a1c|#24185e|#a87b00")
        );
    }

    // ------------------------------------------------------------------ SVG

    function svg(Pet memory p, uint256 itemId) public view returns (string memory) {
        Look memory l = look(p.dna, p.level);
        (string memory main, string memory light, string memory dark) = _palette(l.palette);
        string memory shape = l.stage == 0 ? _egg() : _shape(l.shape);

        string memory out = string.concat(
            '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 400 400"><defs>',
            decor.bgGradient(l.bg),
            '<radialGradient id="b" cx="165" cy="170" r="220" gradientUnits="userSpaceOnUse"><stop offset="0" stop-color="',
            light,
            '"/><stop offset=".55" stop-color="',
            main,
            '"/><stop offset="1" stop-color="',
            dark,
            '"/></radialGradient><radialGradient id="au"><stop offset=".45" stop-color="',
            main,
            '" stop-opacity=".95"/><stop offset=".7" stop-color="#fff" stop-opacity=".6"/><stop offset="1" stop-color="',
            light,
            '" stop-opacity="0"/></radialGradient><clipPath id="c">',
            shape,
            "</clipPath></defs>",
            '<rect width="400" height="400" fill="url(#bg)"/>',
            decor.bgDecor(l.bg)
        );
        if (l.stage == 3) {
            out = string.concat(
                out,
                '<circle cx="200" cy="235" r="165" fill="url(#au)"><animate attributeName="r" values="150;178;150" dur="3s" repeatCount="indefinite"/></circle><g stroke="#fff" stroke-width="6" stroke-linecap="round" opacity=".7"><path d="M200 40V70M200 380V360M40 235H70M360 235H330M87 122L108 143M313 122L292 143"/><animateTransform attributeName="transform" type="rotate" values="0 200 235;360 200 235" dur="24s" repeatCount="indefinite"/></g>'
            );
        }
        out = string.concat(
            out,
            '<ellipse cx="200" cy="350" rx="105" ry="13" fill="#000" opacity=".15"/>',
            '<g><animateTransform attributeName="transform" type="translate" values="0 0;0 -6;0 0" dur="3s" repeatCount="indefinite"/>',
            l.stage == 0 ? _eggBody(shape, dark) : _creature(p, l, shape, dark, itemId),
            "</g>"
        );
        if (l.stage == 3 || l.palette == 9) out = string.concat(out, decor.sparkles());
        return string.concat(out, decor.frame(l.tier), "</svg>");
    }

    function _creature(Pet memory p, Look memory l, string memory shape, string memory dark, uint256 itemId)
        internal
        view
        returns (string memory)
    {
        string memory g = string.concat(
            l.stage == 1 ? '<g transform="translate(200 330) scale(.78) translate(-200 -330)">' : "<g>",
            itemId == 5 ? decor.wings() : "",
            l.stage >= 2 && !(_hat(itemId) && (l.head == 3 || l.head == 4)) ? _headBack(l.head, dark) : "",
            '<g fill="',
            dark,
            '"><ellipse cx="150" cy="333" rx="30" ry="14"/><ellipse cx="250" cy="333" rx="30" ry="14"/></g>',
            '<g fill="url(#b)" stroke="',
            dark,
            '" stroke-width="5">',
            shape,
            '</g><g clip-path="url(#c)">',
            _pattern(l.pattern, dark),
            l.palette == 8 ? _galaxySpeckles() : "",
            "</g>"
        );
        return string.concat(
            g,
            '<ellipse cx="150" cy="172" rx="34" ry="19" fill="#fff" opacity=".45" transform="rotate(-30 150 172)"/>',
            _eyes(l.eyes),
            '<g fill="#ff7aa2" opacity=".5"><ellipse cx="130" cy="262" rx="17" ry="10"/><ellipse cx="270" cy="262" rx="17" ry="10"/></g>',
            _mouth(l.mouth),
            l.stage >= 2 && l.head == 6 && !_hat(itemId) ? _halo() : "",
            p.generation > 1 ? _gem() : "",
            itemId != 5 ? decor.cosmetic(itemId) : "",
            "</g>"
        );
    }

    /// @dev Kopfbedeckung (Zylinder, Krone) verdeckt Spross/Antennen/Heiligenschein
    function _hat(uint256 itemId) internal pure returns (bool) {
        return itemId == 1 || itemId == 3;
    }

    function _shape(uint8 s) internal pure returns (string memory) {
        if (s == 0) return '<ellipse cx="200" cy="235" rx="112" ry="98"/>';
        if (s == 1) return '<path d="M200 118C258 170 314 208 314 262C314 314 264 336 200 336C136 336 86 314 86 262C86 208 142 170 200 118Z"/>';
        if (s == 2) return '<rect x="92" y="132" width="216" height="202" rx="96"/>';
        return '<path d="M200 132C246 132 262 166 262 194C262 216 316 240 316 282C316 322 264 338 200 338C136 338 84 322 84 282C84 240 138 216 138 194C138 166 154 132 200 132Z"/>';
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
            '<g fill="',
            INK,
            '"><circle cx="178" cy="218" r="8"/><circle cx="222" cy="218" r="8"/></g>',
            '<ellipse cx="155" cy="170" rx="22" ry="13" fill="#fff" opacity=".5" transform="rotate(-35 155 170)"/></g>'
        );
    }

    function _headBack(uint8 h, string memory dark) internal pure returns (string memory) {
        if (h == 1) {
            return string.concat(
                '<path d="M116 196L126 88L196 152ZM284 196L274 88L204 152Z" fill="url(#b)" stroke="',
                dark,
                '" stroke-width="5" stroke-linejoin="round"/><path d="M134 168L139 114L174 146ZM266 168L261 114L226 146Z" fill="#ffb3c7"/>'
            );
        }
        if (h == 2) {
            return string.concat(
                '<g fill="url(#b)" stroke="',
                dark,
                '" stroke-width="5"><ellipse cx="158" cy="98" rx="25" ry="66" transform="rotate(-12 158 98)"/><ellipse cx="242" cy="98" rx="25" ry="66" transform="rotate(12 242 98)"/></g>',
                '<g fill="#ffb3c7"><ellipse cx="158" cy="100" rx="11" ry="46" transform="rotate(-12 158 100)"/><ellipse cx="242" cy="100" rx="11" ry="46" transform="rotate(12 242 100)"/></g>'
            );
        }
        if (h == 3) {
            return string.concat(
                '<path d="M180 145Q166 100 146 80M220 145Q234 100 254 80" fill="none" stroke="',
                dark,
                '" stroke-width="5" stroke-linecap="round"/><g fill="#ffd23f" stroke="',
                dark,
                '" stroke-width="4"><circle cx="144" cy="76" r="13"/><circle cx="256" cy="76" r="13"/></g>'
            );
        }
        if (h == 4) {
            return '<path d="M200 145Q197 110 206 92" fill="none" stroke="#3d8b4a" stroke-width="6" stroke-linecap="round"/><path d="M206 96C230 64 268 74 264 88C248 108 222 106 206 96ZM202 104C182 82 152 90 156 100C168 114 188 114 202 104Z" fill="#6cc47a" stroke="#3d8b4a" stroke-width="4"/>';
        }
        if (h == 5) {
            return string.concat(
                '<path d="M142 165Q112 112 148 80Q146 124 172 150ZM258 165Q288 112 252 80Q254 124 228 150Z" fill="#fff3e0" stroke="',
                dark,
                '" stroke-width="5" stroke-linejoin="round"/>'
            );
        }
        return "";
    }

    function _halo() internal pure returns (string memory) {
        return '<ellipse cx="200" cy="92" rx="62" ry="15" fill="none" stroke="#ffd84d" stroke-width="9"><animate attributeName="opacity" values="1;.5;1" dur="2s" repeatCount="indefinite"/></ellipse>';
    }

    function _eyes(uint8 e) internal pure returns (string memory) {
        if (e == 1) {
            return '<path d="M144 230Q162 244 180 230M220 230Q238 244 256 230" fill="none" stroke="#2b2340" stroke-width="6" stroke-linecap="round"/>';
        }
        if (e == 2) {
            return string.concat(
                _roundEye("162"),
                '<path d="M220 232Q238 216 256 232" fill="none" stroke="#2b2340" stroke-width="6" stroke-linecap="round"/>'
            );
        }
        if (e == 3) {
            return string.concat(_sparkleEye("162"), _sparkleEye("238"));
        }
        if (e == 4) {
            return '<g fill="#ff4d7d" stroke="#2b2340" stroke-width="3"><path d="M162 222C162 210 144 210 144 222C144 232 158 238 162 246C166 238 180 232 180 222C180 210 162 210 162 222Z"/><path d="M238 222C238 210 220 210 220 222C220 232 234 238 238 246C242 238 256 232 256 222C256 210 238 210 238 222Z"/></g>';
        }
        if (e == 5) {
            return string.concat(_star("162"), _star("238"));
        }
        return string.concat(_roundEye("162"), _roundEye("238"));
    }

    function _roundEye(string memory x) internal pure returns (string memory) {
        return string.concat(
            '<g transform="translate(',
            x,
            ' 228)"><circle r="17" fill="#2b2340"/><circle cx="5" cy="-6" r="6" fill="#fff"/><circle cx="-5" cy="6" r="3" fill="#fff"/></g>'
        );
    }

    function _sparkleEye(string memory x) internal pure returns (string memory) {
        return string.concat(
            '<g transform="translate(',
            x,
            ' 228)"><ellipse rx="20" ry="25" fill="#2b2340"/><ellipse cy="9" rx="14" ry="12" fill="#6a4cff" opacity=".8"/><circle cx="6" cy="-9" r="8" fill="#fff"/><circle cx="-7" cy="8" r="4" fill="#fff"/></g>'
        );
    }

    function _star(string memory x) internal pure returns (string memory) {
        return string.concat(
            '<polygon transform="translate(',
            x,
            ' 228)" points="0,-20 5.9,-8.1 19,-6.2 9.5,3.1 11.8,16.2 0,10 -11.8,16.2 -9.5,3.1 -19,-6.2 -5.9,-8.1" fill="#ffd23f" stroke="#b8860b" stroke-width="3" stroke-linejoin="round"/>'
        );
    }

    function _mouth(uint8 m) internal pure returns (string memory) {
        if (m == 1) return '<path d="M182 256Q191 268 200 256Q209 268 218 256" fill="none" stroke="#2b2340" stroke-width="5" stroke-linecap="round"/>';
        if (m == 2) return '<ellipse cx="200" cy="264" rx="11" ry="13" fill="#2b2340"/><ellipse cx="200" cy="271" rx="7" ry="5" fill="#ff7aa2"/>';
        if (m == 3) return '<path d="M186 256Q200 270 214 256" fill="none" stroke="#2b2340" stroke-width="5" stroke-linecap="round"/><path d="M194 264Q200 280 206 264Z" fill="#ff7aa2" stroke="#2b2340" stroke-width="2"/>';
        return '<path d="M186 256Q200 270 214 256" fill="none" stroke="#2b2340" stroke-width="5" stroke-linecap="round"/>';
    }

    function _pattern(uint8 pt, string memory dark) internal pure returns (string memory) {
        if (pt == 1) return '<ellipse cx="200" cy="312" rx="78" ry="56" fill="#fff" opacity=".55"/>';
        if (pt == 2) {
            return string.concat(
                '<g fill="',
                dark,
                '" opacity=".28"><circle cx="128" cy="182" r="15"/><circle cx="272" cy="190" r="11"/><circle cx="108" cy="285" r="13"/><circle cx="292" cy="292" r="17"/><circle cx="232" cy="158" r="8"/><circle cx="168" cy="314" r="11"/></g>'
            );
        }
        if (pt == 3) {
            return string.concat(
                '<path d="M200 128V168M174 136L180 166M226 136L220 166M84 228L120 236M84 256L118 260M316 228L280 236M316 256L282 260" stroke="',
                dark,
                '" stroke-width="9" stroke-linecap="round" opacity=".35"/>'
            );
        }
        if (pt == 4) {
            return '<path d="M200 300C200 286 178 286 178 300C178 314 196 322 200 332C204 322 222 314 222 300C222 286 200 286 200 300Z" fill="#ff4d7d" opacity=".85"/>';
        }
        return "";
    }

    function _galaxySpeckles() internal pure returns (string memory) {
        return '<g fill="#fff"><circle cx="130" cy="210" r="2.5"/><circle cx="280" cy="180" r="2"/><circle cx="250" cy="300" r="3"/><circle cx="150" cy="300" r="2"/><circle cx="300" cy="250" r="2.5"/><circle cx="110" cy="260" r="2"/><circle cx="215" cy="150" r="2"/></g>';
    }

    function _gem() internal pure returns (string memory) {
        return '<path d="M200 160L213 176L200 192L187 176Z" fill="#7df9ff" stroke="#2b2340" stroke-width="3"/><path d="M200 164L206 176L200 172Z" fill="#fff"/>';
    }


}
