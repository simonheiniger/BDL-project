// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// @title PetAnatomy – Koerperteile der 6 Spezies (Kopf, Ohren, Schwanz, Schnauze) als SVG
/// @notice Ohren und Schwanz haben eigene Gene: Reinrassige Pets haben alles von einer Spezies,
///         durch Fusion entstehen Mischlinge (z.B. Katze mit Fuchsschwanz).
/// @dev Spezies-Index: 0 Katze, 1 Fuchs, 2 Hase, 3 Baer, 4 Frosch, 5 Drache, 6 Giraffe, 7 Elefant,
///      8 Nashorn, 9 Krokodil, 10 Pinguin, 11 Eule, 12 Schildkroete, 13 Loewe, 14 Wolf.
///      Frosch-/Krokodil-"Ohren" sind Augenhuegel: der Renderer setzt die Augen dann nach oben hinein.
///      Koordinaten: Kopf um (200,185), Koerper um (200,300), Augen auf y=190.
contract PetAnatomy {
    /// @notice Kopfform (ohne fill/stroke, wird auch als Clip-Pfad benutzt)
    function head(uint8 sp) external pure returns (string memory) {
        if (sp == 14) {
            return '<path d="M92 176C92 120 144 95 200 95C256 95 308 120 308 176C308 214 294 240 264 258L292 274L238 276C216 280 184 280 162 276L108 274L136 258C106 240 92 214 92 176Z"/>';
        }
        if (sp == 1) {
            return '<path d="M95 178C95 122 145 97 200 97C255 97 305 122 305 178C305 216 290 244 258 260L278 270L232 273C214 276 186 276 168 273L122 270L142 260C110 244 95 216 95 178Z"/>';
        }
        if (sp == 2) return '<ellipse cx="200" cy="187" rx="98" ry="88"/>';
        if (sp == 3) return '<ellipse cx="200" cy="187" rx="108" ry="86"/>';
        if (sp == 4) return '<ellipse cx="200" cy="195" rx="116" ry="78"/>';
        if (sp == 6) return '<ellipse cx="200" cy="182" rx="86" ry="80"/>';
        if (sp == 7) return '<ellipse cx="200" cy="185" rx="108" ry="90"/>';
        if (sp == 8) return '<ellipse cx="200" cy="190" rx="100" ry="84"/>';
        if (sp == 9) return '<ellipse cx="200" cy="200" rx="112" ry="70"/>';
        if (sp == 12) return '<ellipse cx="200" cy="198" rx="84" ry="74"/>';
        return '<ellipse cx="200" cy="185" rx="104" ry="88"/>';
    }

    /// @notice Ohren (hinter dem Kopf gezeichnet)
    function ears(uint8 sp, string memory dark) external pure returns (string memory) {
        string memory st = string.concat('" stroke="', dark, '" stroke-width="5" stroke-linejoin="round"');
        if (sp == 0) {
            return string.concat(
                '<path d="M106 162L116 70L182 116ZM294 162L284 70L218 116Z" fill="url(#b)',
                st,
                '/><path d="M124 140L128 96L160 120ZM276 140L272 96L240 120Z" fill="#ffb3c7"/>'
            );
        }
        if (sp == 1) {
            return string.concat(
                '<path d="M100 156L108 46L186 110ZM300 156L292 46L214 110Z" fill="url(#b)',
                st,
                '/><path d="M118 132L122 76L162 110ZM282 132L278 76L238 110Z" fill="#fff" opacity=".85"/><path d="M108 46L106 82L130 66ZM292 46L294 82L270 66Z" fill="',
                dark,
                '"/>'
            );
        }
        if (sp == 2) {
            return string.concat(
                '<g fill="url(#b)',
                st,
                '><ellipse cx="160" cy="68" rx="24" ry="66" transform="rotate(-10 160 68)"/><ellipse cx="240" cy="68" rx="24" ry="66" transform="rotate(10 240 68)"/></g><g fill="#ffb3c7"><ellipse cx="160" cy="72" rx="11" ry="46" transform="rotate(-10 160 72)"/><ellipse cx="240" cy="72" rx="11" ry="46" transform="rotate(10 240 72)"/></g>'
            );
        }
        if (sp == 3) {
            return string.concat(
                '<g fill="url(#b)',
                st,
                '><circle cx="124" cy="114" r="32"/><circle cx="276" cy="114" r="32"/></g><g fill="#ffb3c7" opacity=".8"><circle cx="124" cy="114" r="15"/><circle cx="276" cy="114" r="15"/></g>'
            );
        }
        if (sp == 4) {
            return string.concat(
                '<g fill="url(#b)',
                st,
                '><circle cx="160" cy="128" r="38"/><circle cx="240" cy="128" r="38"/></g><g fill="#fff"><circle cx="160" cy="128" r="26"/><circle cx="240" cy="128" r="26"/></g>'
            );
        }
        if (sp == 6) {
            return string.concat(
                '<path d="M172 118L166 74M228 118L234 74" stroke="',
                dark,
                '" stroke-width="10" stroke-linecap="round"/><g fill="#3a2a22"><circle cx="166" cy="72" r="10"/><circle cx="234" cy="72" r="10"/></g><g fill="url(#b)',
                st,
                '><ellipse cx="112" cy="150" rx="34" ry="14" transform="rotate(-20 112 150)"/><ellipse cx="288" cy="150" rx="34" ry="14" transform="rotate(20 288 150)"/></g>'
            );
        }
        if (sp == 7) {
            return string.concat(
                '<g fill="url(#b)',
                st,
                '><ellipse cx="90" cy="195" rx="64" ry="82"/><ellipse cx="310" cy="195" rx="64" ry="82"/></g><g fill="#ffb3c7" opacity=".7"><ellipse cx="96" cy="195" rx="40" ry="58"/><ellipse cx="304" cy="195" rx="40" ry="58"/></g>'
            );
        }
        if (sp == 8) {
            return string.concat('<path d="M124 150L126 92L166 128ZM276 150L274 92L234 128Z" fill="url(#b)', st, "/>");
        }
        if (sp == 14) {
            return string.concat(
                '<path d="M108 158L118 56L184 114ZM292 158L282 56L216 114Z" fill="',
                dark,
                st,
                '/><path d="M126 136L130 88L164 116ZM274 136L270 88L236 116Z" fill="#f4f1ea"/>'
            );
        }
        if (sp == 9) {
            return string.concat('<g fill="url(#b)', st, '><circle cx="160" cy="138" r="28"/><circle cx="240" cy="138" r="28"/></g><g fill="#fff"><circle cx="160" cy="132" r="18"/><circle cx="240" cy="132" r="18"/></g>');
        }
        if (sp == 11) {
            return string.concat('<path d="M110 140L118 70L160 112ZM290 140L282 70L240 112Z" fill="', dark, '"/>');
        }
        if (sp == 13) {
            return string.concat('<g fill="url(#b)', st, '><circle cx="132" cy="112" r="24"/><circle cx="268" cy="112" r="24"/></g>');
        }
        if (sp == 10 || sp == 12) return "";
        // Drache: Hoerner + Flossen-Ohren
        return string.concat(
            '<path d="M96 178L52 150L74 192L50 220L98 208ZM304 178L348 150L326 192L350 220L302 208Z" fill="url(#b)',
            st,
            '/><path d="M146 116Q120 66 154 38Q154 84 176 106ZM254 116Q280 66 246 38Q246 84 224 106Z" fill="#fff3e0',
            st,
            "/>"
        );
    }

    /// @notice Schwanz (hinter dem Koerper, rechts)
    function tail(uint8 sp, string memory main, string memory dark) external pure returns (string memory) {
        if (sp == 0) {
            return string.concat(
                '<path d="M256 332C318 336 340 282 312 236" fill="none" stroke="',
                dark,
                '" stroke-width="28" stroke-linecap="round"/><path d="M256 332C318 336 340 282 312 236" fill="none" stroke="',
                main,
                '" stroke-width="18" stroke-linecap="round"/>'
            );
        }
        if (sp == 1) {
            return string.concat(
                '<path d="M250 334C334 346 368 272 336 214C320 252 300 276 262 292Z" fill="url(#b)" stroke="',
                dark,
                '" stroke-width="5" stroke-linejoin="round"/><path d="M336 214C348 236 352 256 346 274C330 266 322 244 336 214Z" fill="#fff"/>'
            );
        }
        if (sp == 2) {
            return string.concat('<circle cx="272" cy="330" r="24" fill="#fff" stroke="', dark, '" stroke-width="5"/>');
        }
        if (sp == 3) {
            return string.concat('<circle cx="264" cy="336" r="17" fill="url(#b)" stroke="', dark, '" stroke-width="5"/>');
        }
        if (sp == 4 || sp == 12) return "";
        if (sp == 14) {
            return string.concat(
                '<path d="M256 318C300 320 330 340 340 372C318 378 290 370 262 346Z" fill="url(#b)" stroke="',
                dark,
                '" stroke-width="5" stroke-linejoin="round"/><path d="M340 372C330 360 318 356 310 362C318 372 330 376 340 372Z" fill="',
                dark,
                '"/>'
            );
        }
        if (sp == 6 || sp == 7 || sp == 8 || sp == 13) {
            // duenner Schwanz mit Quaste (Loewe laenger, nach oben)
            return string.concat(
                sp == 13 ? '<path d="M262 320C320 330 330 270 310 240" fill="none" stroke="' : '<path d="M268 318C296 326 304 344 300 362" fill="none" stroke="',
                main,
                '" stroke-width="9" stroke-linecap="round"/><ellipse cx="',
                sp == 13 ? "308" : "300",
                '" cy="',
                sp == 13 ? "232" : "368",
                '" rx="14" ry="18" fill="',
                dark,
                '"/>'
            );
        }
        if (sp == 9) {
            return string.concat(
                '<path d="M250 336C310 350 350 344 380 330L384 340C350 362 300 366 256 352Z" fill="url(#b)" stroke="',
                dark,
                '" stroke-width="5" stroke-linejoin="round"/><path d="M290 342l8-12 8 12M320 340l8-12 8 12M348 336l7-11 7 11" fill="',
                dark,
                '"/>'
            );
        }
        if (sp == 10) return string.concat('<path d="M262 340L300 358L270 362Z" fill="', dark, '"/>');
        if (sp == 11) {
            return string.concat(
                '<g fill="',
                dark,
                '"><ellipse cx="282" cy="340" rx="34" ry="12" transform="rotate(-20 282 340)"/><ellipse cx="286" cy="352" rx="34" ry="11" transform="rotate(0 286 352)"/></g>'
            );
        }
        return string.concat(
            '<path d="M252 330C312 346 348 320 354 284L374 268L360 300L378 306L354 314C342 348 300 356 258 348Z" fill="url(#b)" stroke="',
            dark,
            '" stroke-width="5" stroke-linejoin="round"/>'
        );
    }

    /// @notice Schnauze + Nase (Mund kommt separat aus dem Mund-Gen)
    function snout(uint8 sp, string memory light, string memory dark) external pure returns (string memory) {
        if (sp == 0) {
            return string.concat(
                '<path d="M118 210L80 202M118 222L82 228M282 210L320 202M282 222L318 228" stroke="',
                dark,
                '" stroke-width="3" stroke-linecap="round" opacity=".6"/><path d="M192 206H208L200 215Z" fill="#ff7aa2"/>'
            );
        }
        if (sp == 1) {
            return '<ellipse cx="200" cy="228" rx="48" ry="30" fill="#fff" opacity=".9"/><ellipse cx="200" cy="210" rx="10" ry="7" fill="#2b2340"/>';
        }
        if (sp == 2) {
            return '<rect x="193" y="232" width="14" height="12" rx="3" fill="#fff" stroke="#2b2340" stroke-width="2"/><ellipse cx="200" cy="211" rx="8" ry="6" fill="#ff7aa2"/>';
        }
        if (sp == 3) {
            return string.concat(
                '<ellipse cx="200" cy="224" rx="38" ry="28" fill="',
                light,
                '"/><ellipse cx="200" cy="210" rx="13" ry="9" fill="#2b2340"/>'
            );
        }
        if (sp == 4) {
            return '<g fill="#2b2340"><circle cx="190" cy="200" r="3"/><circle cx="210" cy="200" r="3"/></g><path d="M138 216Q200 258 262 216" fill="none" stroke="#2b2340" stroke-width="5" stroke-linecap="round"/>';
        }
        if (sp == 14) {
            return '<g fill="#f4f1ea"><ellipse cx="200" cy="232" rx="54" ry="38"/><ellipse cx="160" cy="166" rx="18" ry="9"/><ellipse cx="240" cy="166" rx="18" ry="9"/></g><ellipse cx="200" cy="214" rx="13" ry="9" fill="#1a1216"/><path d="M200 222V232" stroke="#1a1216" stroke-width="4"/>';
        }
        if (sp == 6) {
            return string.concat(
                '<g fill="',
                dark,
                '" opacity=".35"><ellipse cx="160" cy="130" rx="16" ry="12"/><ellipse cx="236" cy="124" rx="13" ry="10"/><ellipse cx="270" cy="200" rx="11" ry="14"/></g><ellipse cx="200" cy="226" rx="42" ry="32" fill="',
                light,
                '"/><g fill="#2b2340"><ellipse cx="188" cy="220" rx="4" ry="5"/><ellipse cx="212" cy="220" rx="4" ry="5"/></g>'
            );
        }
        if (sp == 7) {
            return string.concat(
                '<path d="M200 214C200 262 186 290 214 316" fill="none" stroke="',
                dark,
                '" stroke-width="40" stroke-linecap="round"/><path d="M200 214C200 262 186 290 214 316" fill="none" stroke="url(#b)" stroke-width="30" stroke-linecap="round"/><path d="M168 236Q150 262 158 280M232 236Q250 262 242 280" fill="none" stroke="#fbf6e8" stroke-width="9" stroke-linecap="round"/>'
            );
        }
        if (sp == 8) {
            return string.concat(
                '<ellipse cx="200" cy="232" rx="54" ry="36" fill="',
                light,
                '"/><path d="M186 214L204 132L222 212Z" fill="#efe6d0" stroke="',
                dark,
                '" stroke-width="4" stroke-linejoin="round"/><g fill="#2b2340"><ellipse cx="184" cy="236" rx="5" ry="6"/><ellipse cx="216" cy="236" rx="5" ry="6"/></g>'
            );
        }
        if (sp == 9) {
            return string.concat(
                '<ellipse cx="200" cy="238" rx="78" ry="34" fill="url(#b)" stroke="',
                dark,
                '" stroke-width="5"/><path d="M134 246l8 10 8-10 8 10 8-10 8 10 8-10 8 10 8-10 8 10 8-10 8 10 8-10 8 10 8-10 8 10" fill="#fff" stroke="#2b2340" stroke-width="2" stroke-linejoin="round"/><g fill="#2b2340"><circle cx="186" cy="222" r="3"/><circle cx="214" cy="222" r="3"/></g>'
            );
        }
        if (sp == 10) return '<ellipse cx="200" cy="205" rx="74" ry="62" fill="#fff"/><path d="M184 212L216 212L200 236Z" fill="#f2a33a" stroke="#2b2340" stroke-width="3" stroke-linejoin="round"/>';
        if (sp == 11) {
            return string.concat(
                '<g fill="',
                light,
                '"><circle cx="160" cy="190" r="34"/><circle cx="240" cy="190" r="34"/></g><path d="M190 206L210 206L200 230Z" fill="#e3b23c" stroke="#2b2340" stroke-width="3" stroke-linejoin="round"/>'
            );
        }
        if (sp == 12 || sp == 13) {
            return string.concat(
                '<ellipse cx="200" cy="226" rx="38" ry="26" fill="',
                light,
                '"/><ellipse cx="200" cy="212" rx="11" ry="8" fill="#2b2340"/>'
            );
        }
        return string.concat(
            '<ellipse cx="200" cy="222" rx="34" ry="22" fill="',
            light,
            '" opacity=".85"/><g fill="#2b2340"><ellipse cx="190" cy="212" rx="3" ry="4"/><ellipse cx="210" cy="212" rx="3" ry="4"/></g>'
        );
    }

    /// @notice Koerperteile hinter dem Kopf (vor dem Rumpf): Panzer, Maehne, Giraffenhals
    function back(uint8 sp, string memory dark) external pure returns (string memory) {
        if (sp == 12) {
            return string.concat(
                '<path d="M60 310C60 200 130 150 200 150C270 150 340 200 340 310Z" fill="#5b7a3a" stroke="',
                dark,
                '" stroke-width="6"/><path d="M200 168L240 200L226 250L174 250L160 200ZM120 230L160 200L174 250L140 290L96 280ZM280 230L240 200L226 250L260 290L304 280Z" fill="#7a9a4f" stroke="#3d5524" stroke-width="4" stroke-linejoin="round"/>'
            );
        }
        if (sp == 13) {
            return string.concat(
                '<path d="M200 70L226 98L262 84L268 120L304 124L292 158L322 180L294 202L312 234L276 240L272 276L238 264L218 294L200 268L182 294L162 264L128 276L124 240L88 234L106 202L78 180L108 158L96 124L132 120L138 84L174 98Z" fill="',
                dark,
                '" stroke="#2b2340" stroke-width="4" stroke-linejoin="round"/>'
            );
        }
        if (sp == 6) return '<rect x="170" y="200" width="60" height="110" rx="26" fill="url(#b)"/>';
        if (sp == 14) {
            return '<path d="M140 250L160 300L176 268L200 312L224 268L240 300L260 250Z" fill="#f4f1ea" stroke="#2b2340" stroke-width="4" stroke-linejoin="round"/>';
        }
        return "";
    }
}
