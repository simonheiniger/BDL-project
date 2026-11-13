// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// @title PetDecor – Hintergruende, Cosmetics, Rahmen fuer PetRenderer
/// @dev Ausgelagert, weil PetRenderer sonst ueber dem 24-KB-Limit pro Contract (EIP-170) laege.
contract PetDecor {
    // ------------------------------------------------------------------ Cosmetics (IDs wie im Deploy-Script)

    function cosmetic(uint256 id) external pure returns (string memory) {
        if (id == 1) {
            return '<g><rect x="150" y="66" width="100" height="72" rx="8" fill="#2b2340"/><rect x="150" y="116" width="100" height="14" fill="#e63946"/><ellipse cx="200" cy="140" rx="80" ry="14" fill="#2b2340"/><rect x="160" y="74" width="10" height="40" rx="5" fill="#fff" opacity=".15"/></g>';
        }
        if (id == 2) {
            return '<g fill="#1a1a2e"><rect x="132" y="208" width="58" height="40" rx="15"/><rect x="210" y="208" width="58" height="40" rx="15"/></g><path d="M190 220Q200 212 210 220" fill="none" stroke="#1a1a2e" stroke-width="6"/><path d="M144 219H162M222 219H240" stroke="#fff" stroke-width="4" stroke-linecap="round" opacity=".6"/>';
        }
        if (id == 3) {
            return '<path d="M143 148L148 94L174 122L200 84L226 122L252 94L257 148Z" fill="#ffd23f" stroke="#b8860b" stroke-width="4" stroke-linejoin="round"/><circle cx="200" cy="124" r="8" fill="#e63946"/><circle cx="164" cy="134" r="5" fill="#4cc9f0"/><circle cx="236" cy="134" r="5" fill="#4cc9f0"/>';
        }
        if (id == 4) {
            return '<g fill="#e63946" stroke="#9d0208" stroke-width="4" stroke-linejoin="round"><path d="M240 306L264 362L236 364L224 312Z"/><path d="M96 280Q200 318 304 280L308 304Q200 344 92 304Z"/></g><path d="M120 296Q200 322 280 296" fill="none" stroke="#fff" stroke-width="4" stroke-dasharray="10 12" opacity=".7"/>';
        }
        return "";
    }

    function wings() external pure returns (string memory) {
        return '<g fill="#fff" stroke="#c9c3e6" stroke-width="4"><path d="M112 232C40 168 14 232 48 262C18 284 62 324 112 292Z"><animateTransform attributeName="transform" type="rotate" values="0 112 260;-10 112 260;0 112 260" dur="1.2s" repeatCount="indefinite"/></path><path d="M288 232C360 168 386 232 352 262C382 284 338 324 288 292Z"><animateTransform attributeName="transform" type="rotate" values="0 288 260;10 288 260;0 288 260" dur="1.2s" repeatCount="indefinite"/></path></g>';
    }

    // ------------------------------------------------------------------ Hintergrund

    function bgGradient(uint8 b) external pure returns (string memory) {
        return string.concat(
            '<linearGradient id="bg" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="',
            _pick(b, "#ffd1a1|#e0fff4|#1b1f4b|#ffe3f3|#c2f0ff|#fff8e7"),
            '"/><stop offset="1" stop-color="',
            _pick(b, "#ff8fab|#9be7c4|#3b2a6b|#d9d4ff|#5ab8e8|#ffe9c2"),
            '"/></linearGradient>'
        );
    }

    function bgDecor(uint8 b) external pure returns (string memory) {
        if (b == 0) return '<circle cx="320" cy="88" r="42" fill="#fff3b0" opacity=".75"/>';
        if (b == 1) return '<ellipse cx="200" cy="420" rx="300" ry="90" fill="#7fd6a8"/>';
        if (b == 2) {
            return '<g fill="#fff"><circle cx="50" cy="60" r="2"/><circle cx="120" cy="35" r="1.5"/><circle cx="330" cy="50" r="2.5"/><circle cx="360" cy="140" r="1.5"/><circle cx="40" cy="170" r="1.5"/><circle cx="280" cy="30" r="1.5"/><circle cx="85" cy="110" r="1"/><circle cx="350" cy="230" r="2"/></g><circle cx="330" cy="80" r="26" fill="#fff6d5"/><circle cx="342" cy="72" r="24" fill="#1b1f4b"/>';
        }
        if (b == 3) {
            return '<g fill="#fff" opacity=".8"><circle cx="70" cy="80" r="26"/><circle cx="100" cy="70" r="30"/><circle cx="130" cy="84" r="22"/><circle cx="300" cy="120" r="20"/><circle cx="325" cy="110" r="26"/><circle cx="350" cy="124" r="18"/></g>';
        }
        if (b == 4) {
            return '<g fill="none" stroke="#fff" stroke-width="3" opacity=".7"><circle cx="60" cy="300" r="12"/><circle cx="80" cy="250" r="7"/><circle cx="340" cy="200" r="10"/><circle cx="355" cy="160" r="6"/><circle cx="330" cy="90" r="14"/></g>';
        }
        return '<g opacity=".7"><circle cx="60" cy="70" r="6" fill="#ff9cc6"/><circle cx="340" cy="90" r="5" fill="#86c5ff"/><circle cx="80" cy="330" r="5" fill="#ffd23f"/><circle cx="330" cy="320" r="6" fill="#7fe0c0"/><circle cx="300" cy="40" r="4" fill="#b9a3ff"/></g>';
    }
    function sparkles() external pure returns (string memory) {
        return '<g fill="#fff"><path d="M60 80l6 14 14 6-14 6-6 14-6-14-14-6 14-6z"><animate attributeName="opacity" values="1;.2;1" dur="1.6s" repeatCount="indefinite"/></path><path d="M335 120l5 11 11 5-11 5-5 11-5-11-11-5 11-5z"><animate attributeName="opacity" values=".2;1;.2" dur="1.8s" repeatCount="indefinite"/></path><path d="M320 320l4 9 9 4-9 4-4 9-4-9-9-4 9-4z"><animate attributeName="opacity" values="1;.3;1" dur="2.2s" repeatCount="indefinite"/></path></g>';
    }

    /// @notice Seltenheits-Rahmen + Badge -> Seltenheit ist im Bild selbst sichtbar (auf jedem Marktplatz)
    function frame(uint8 tier) external pure returns (string memory) {
        if (tier == 0) return "";
        string memory c = _pick(tier, "|#4cc9f0|#b15cff|#ffc83d");
        string memory w = _pick(tier, "|74|70|118");
        return string.concat(
            '<rect x="5" y="5" width="390" height="390" rx="22" fill="none" stroke="',
            c,
            '" stroke-width="8"',
            tier == 3 ? '><animate attributeName="stroke-opacity" values="1;.55;1" dur="2s" repeatCount="indefinite"/></rect>' : "/>",
            '<rect x="16" y="16" width="',
            w,
            '" height="26" rx="13" fill="',
            c,
            '"/><text x="',
            _pick(tier, "|53|51|75"),
            '" y="34" text-anchor="middle" font-family="Arial,sans-serif" font-size="13" font-weight="700" fill="#1f1d2e">',
            _pick(tier, "|RARE|EPIC|LEGENDARY"),
            "</text>"
        );
    }

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
}
