// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Math} from "@openzeppelin/contracts/utils/math/Math.sol";

/// @title GameMath – alle Balance-Formeln an einem Ort (siehe docs/konzept.md)
/// @dev Reine Funktionen, keine Cosmetics als Input -> No-Pay-to-Win ist im Code garantiert.
library GameMath {
    uint256 internal constant STR = 0;
    uint256 internal constant AGI = 1;
    uint256 internal constant INT = 2;
    uint256 internal constant VIT = 3;

    uint256 internal constant MAX_LEVEL = 50;
    uint256 internal constant STAT_CAP = 200;
    uint256 internal constant XP_BASE = 50; // xpToNext(L) = 50 * L^1.5
    uint256 internal constant POWER_FLOOR = 2000; // C: Underdog-Chance im Turnier
    uint256 internal constant FUSION_BONUS_BP = 3000; // 30 % des schwaecheren Elternteils
    uint256 internal constant FUSION_XP_BP = 5000; // 50 % der Gesamt-XP des verbrannten Pets
    uint256 internal constant FUSION_MIN_LEVEL = 5;

    /// @notice XP von Level L auf L+1: 50 * L * sqrt(L)
    /// @dev sqrt(L * 1e6) / 1e3 = sqrt(L) mit 3 Nachkommastellen (Solidity kennt keine Gleitkommazahlen).
    function xpToNext(uint256 level) internal pure returns (uint256) {
        return (XP_BASE * level * Math.sqrt(level * 1e6)) / 1e3;
    }

    /// @notice Turnier-Power: P = (Σ w_i * stat_i) * (1 + L/25) + C
    /// @param weights Challenge-Gewichte, Summe = 100
    function power(uint16[4] memory stats, uint256 level, uint16[4] memory weights) internal pure returns (uint256) {
        uint256 score;
        for (uint256 i = 0; i < 4; ++i) {
            score += uint256(weights[i]) * stats[i];
        }
        return (score * (100 + 4 * level)) / 100 + POWER_FLOOR;
    }

    /// @notice Gewichtete Ziehung: Index j mit Wahrscheinlichkeit P_j / Σ P.
    function weightedPick(uint256[] memory powers, uint256 rand) internal pure returns (uint256 idx, uint256 total) {
        for (uint256 i = 0; i < powers.length; ++i) {
            total += powers[i];
        }
        if (total == 0) return (type(uint256).max, 0);
        uint256 r = rand % total;
        for (uint256 i = 0; i < powers.length; ++i) {
            if (r < powers[i]) return (i, total);
            r -= powers[i];
        }
        revert("unreachable");
    }

    /// @notice Stat-Vererbung: max + min * 30% / (1 + fusionCount), gekappt bei STAT_CAP.
    ///         Diminishing Returns verhindern Runaway durch Kettenfusion.
    function fuseStats(uint16[4] memory a, uint16[4] memory b, uint256 fusionCount)
        internal
        pure
        returns (uint16[4] memory out)
    {
        for (uint256 i = 0; i < 4; ++i) {
            uint256 hi = Math.max(a[i], b[i]);
            uint256 lo = Math.min(a[i], b[i]);
            uint256 v = hi + (lo * FUSION_BONUS_BP) / (10_000 * (1 + fusionCount));
            out[i] = uint16(Math.min(v, STAT_CAP));
        }
    }

    /// @notice Gesamt-XP eines Pets (alle bisherigen Level + XP im aktuellen Level).
    function totalXp(uint256 level, uint256 xp) internal pure returns (uint256 total) {
        for (uint256 l = 1; l < level; ++l) {
            total += xpToNext(l);
        }
        total += xp;
    }

    /// @notice Umkehrung von totalXp: (Level, Rest-XP) aus Gesamt-XP.
    function levelFromXp(uint256 total) internal pure returns (uint256 level, uint256 rem) {
        level = 1;
        while (level < MAX_LEVEL && total >= xpToNext(level)) {
            total -= xpToNext(level);
            ++level;
        }
        rem = level == MAX_LEVEL ? 0 : total;
    }

    /// @notice Level-Vererbung ueber XP (nicht ueber Level!): XP' = XP_keep + 50 % * XP_burn.
    /// @dev Erste Version "max(L) + min(L)/4" war ausnutzbar: Lv20 + billiges Lv5-Pet ergab +11 % XP-Wert
    ///      (siehe sim/). Ueber XP gerechnet wird bei JEDER Fusion Wert vernichtet -> echter Token-Sink.
    function fuseXp(uint256 keepTotal, uint256 burnTotal) internal pure returns (uint256 level, uint256 rem) {
        return levelFromXp(keepTotal + (burnTotal * FUSION_XP_BP) / 10_000);
    }
}
