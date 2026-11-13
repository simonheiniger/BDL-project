// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// @notice Zustand eines Pets (geteilt von PetNFT, PetRenderer und Arena)
struct Pet {
    uint16[4] stats; // STR, AGI, INT, VIT
    uint8[4] focus; // Aktionen pro Stat seit letztem Level-Up
    uint16 level;
    uint32 xp; // XP innerhalb des aktuellen Levels
    uint64 lastAction;
    uint64 dayStart;
    uint16 actionsToday;
    uint8 fusionCount;
    uint8 generation;
    uint8 equipped; // angezogenes Cosmetic (0 = keins), nur sichtbar solange es im TBA liegt
    uint256 dna; // 7 Gene a 16 Bit -> Aussehen (siehe PetRenderer)
}
