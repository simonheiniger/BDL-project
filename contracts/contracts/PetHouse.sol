// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {ERC721} from "@openzeppelin/contracts/token/ERC721/ERC721.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {EIP712} from "@openzeppelin/contracts/utils/cryptography/EIP712.sol";
import {ECDSA} from "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";
import {Strings} from "@openzeppelin/contracts/utils/Strings.sol";
import {Base64} from "@openzeppelin/contracts/utils/Base64.sol";

interface IPetOwner {
    function ownerOf(uint256 petId) external view returns (address);
}

/// @title PetHouse – physisches 3D-Haus mit NFC-Chip als ERC-721
/// @notice Pets leben in Haeusern. Ein Haus hat eine Qualitaetsstufe (Huette ... Villa): sie bestimmt die Anzahl
///         Plaetze und wie schnell die Zufriedenheit der Bewohner sinkt. Pflegen geht nur nach einem NFC-Scan
///         des Hauses (Signatur des Chip-Schluessels, siehe `scan`).
/// @dev Das Haus ist die Mint-Kapazitaet des Spiels: Pets lassen sich nur in freie Plaetze minten. Die Zahl der
///      Pets ist damit durch die Zahl (und Groesse) der real gedruckten Haeuser begrenzt.
contract PetHouse is ERC721, EIP712, Ownable {
    uint8 public constant TIERS = 5;
    uint8 public constant MAX_MOOD = 100;
    uint8 public constant MOOD_PER_CARE = 25;
    uint256 public constant MAX_SCAN_TTL = 1 hours;

    bytes32 private constant SCAN_TYPEHASH =
        keccak256("Scan(address player,uint256 petId,uint256 houseId,uint256 nonce,uint256 expiry)");

    struct House {
        uint8 tier; // 0 Huette, 1 Bauernhaus, 2 Cottage, 3 Herrenhaus, 4 Villa
        uint8 occupants;
        address tag; // oeffentlicher Schluessel des NFC-Chips (der private steckt in der Chip-URL)
        uint64 nonce; // Replay-Schutz fuer Scan-Signaturen
    }

    struct Mood {
        uint8 value; // Zufriedenheit beim letzten Update (0..100)
        uint64 at; // Zeitpunkt des letzten Updates
    }

    address public pets; // PetNFT, einmalig gesetzt
    uint256 public nextHouseId = 1;
    mapping(uint256 => House) public houses;
    mapping(uint256 => uint256) public houseOf; // petId -> houseId (0 = nicht untergebracht)
    mapping(uint256 => Mood) private _mood;

    event HouseMinted(uint256 indexed houseId, address indexed to, uint8 tier, address tag);
    event TagChanged(uint256 indexed houseId, address tag);
    event MovedIn(uint256 indexed petId, uint256 indexed houseId);
    event MovedOut(uint256 indexed petId, uint256 indexed houseId);
    event Cared(uint256 indexed petId, uint256 indexed houseId, uint256 moodBefore, uint256 moodAfter);

    error AlreadyConfigured();
    error NotPets();
    error InvalidTier();
    error NotHouseOwner();
    error NotPetOwner();
    error HouseFull();
    error NotHoused();
    error HouseNotEmpty();
    error ScanExpired();
    error BadScan();

    constructor() ERC721("BDL House", "BHOUSE") EIP712("BDL Pet House", "1") Ownable(msg.sender) {}

    function setPets(address pets_) external onlyOwner {
        if (pets != address(0)) revert AlreadyConfigured();
        pets = pets_;
    }

    modifier onlyPets() {
        if (msg.sender != pets) revert NotPets();
        _;
    }

    // ------------------------------------------------------------------ Haus-Tabelle

    /// @notice Plaetze pro Stufe
    function capacityOf(uint8 tier) public pure returns (uint8) {
        if (tier >= TIERS) revert InvalidTier();
        return tier + 1; // 1, 2, 3, 4, 5
    }

    /// @notice Zufriedenheit, die ein Pet pro Tag verliert (je besser das Haus, desto weniger)
    function decayPerDay(uint8 tier) public pure returns (uint8) {
        if (tier >= TIERS) revert InvalidTier();
        uint8[5] memory d = [40, 30, 20, 12, 6];
        return d[tier];
    }

    function tierName(uint8 tier) public pure returns (string memory) {
        if (tier >= TIERS) revert InvalidTier();
        string[5] memory n = ["Huette", "Bauernhaus", "Cottage", "Herrenhaus", "Villa"];
        return n[tier];
    }

    // ------------------------------------------------------------------ Haeuser pragen (= physisches Haus verkaufen)

    /// @notice Neues Haus fuer einen frisch gedruckten Chip. `tag` = Adresse des Chip-Schluessels.
    function mintHouse(address to, uint8 tier, address tag) external onlyOwner returns (uint256 houseId) {
        if (tier >= TIERS) revert InvalidTier();
        houseId = nextHouseId++;
        houses[houseId] = House({tier: tier, occupants: 0, tag: tag, nonce: 0});
        _mint(to, houseId);
        emit HouseMinted(houseId, to, tier, tag);
    }

    /// @notice Chip neu programmieren (z.B. nach dem Kauf eines gebrauchten Hauses): alter Schluessel wird wertlos.
    function setTag(uint256 houseId, address tag) external {
        if (ownerOf(houseId) != msg.sender) revert NotHouseOwner();
        houses[houseId].tag = tag;
        emit TagChanged(houseId, tag);
    }

    // ------------------------------------------------------------------ Einziehen / Ausziehen

    function moveIn(uint256 petId, uint256 houseId) external {
        if (IPetOwner(pets).ownerOf(petId) != msg.sender) revert NotPetOwner();
        if (ownerOf(houseId) != msg.sender) revert NotHouseOwner();
        _leave(petId);
        _enter(petId, houseId);
        // Zufriedenheit blieb waehrend der Zeit ausserhalb eingefroren: Zeitstempel neu starten
        _mood[petId].at = uint64(block.timestamp);
    }

    function moveOut(uint256 petId) external {
        if (IPetOwner(pets).ownerOf(petId) != msg.sender) revert NotPetOwner();
        if (houseOf[petId] == 0) revert NotHoused();
        _leave(petId);
    }

    /// @dev PetNFT.mint: neues Pet zieht direkt ein, startet mit voller Zufriedenheit.
    function onMint(uint256 petId, uint256 houseId, address minter) external onlyPets {
        if (ownerOf(houseId) != minter) revert NotHouseOwner();
        _enter(petId, houseId);
        _mood[petId] = Mood(MAX_MOOD, uint64(block.timestamp));
    }

    /// @dev PetNFT: Pet wurde verkauft/verschoben/verbrannt -> Platz freigeben.
    function onPetLeft(uint256 petId) external onlyPets {
        _leave(petId);
    }

    /// @dev PetNFT.interact: prueft den NFC-Scan und belohnt die Pflege mit Zufriedenheit.
    ///      Der Chip-Schluessel signiert (EIP-712) Spieler, Pet, Haus, Nonce und Ablaufzeit. Nur wer die Chip-URL
    ///      gescannt hat, kennt den Schluessel. Nonce macht jede Signatur zum Einmal-Ticket.
    /// @return moodBefore Zufriedenheit VOR dieser Pflege (bestimmt den XP-Bonus/Malus)
    function scan(uint256 petId, address player, uint256 expiry, bytes calldata sig)
        external
        onlyPets
        returns (uint256 moodBefore)
    {
        uint256 houseId = houseOf[petId];
        if (houseId == 0) revert NotHoused();
        if (ownerOf(houseId) != player) revert NotHouseOwner();
        if (expiry < block.timestamp || expiry > block.timestamp + MAX_SCAN_TTL) revert ScanExpired();

        House storage h = houses[houseId];
        bytes32 digest = _hashTypedDataV4(
            keccak256(abi.encode(SCAN_TYPEHASH, player, petId, houseId, uint256(h.nonce), expiry))
        );
        if (ECDSA.recover(digest, sig) != h.tag) revert BadScan();
        h.nonce++;

        moodBefore = moodOf(petId);
        uint256 after_ = moodBefore + MOOD_PER_CARE;
        if (after_ > MAX_MOOD) after_ = MAX_MOOD;
        _mood[petId] = Mood(uint8(after_), uint64(block.timestamp));
        emit Cared(petId, houseId, moodBefore, after_);
    }

    // ------------------------------------------------------------------ Zufriedenheit

    /// @notice Aktuelle Zufriedenheit 0..100. Im Haus sinkt sie linear mit der Stufe; ausserhalb ist sie eingefroren.
    function moodOf(uint256 petId) public view returns (uint256) {
        Mood memory m = _mood[petId];
        uint256 houseId = houseOf[petId];
        if (houseId == 0) return m.value;
        uint256 lost = ((block.timestamp - m.at) * decayPerDay(houses[houseId].tier)) / 1 days;
        return lost >= m.value ? 0 : m.value - lost;
    }

    // ------------------------------------------------------------------ intern

    function _enter(uint256 petId, uint256 houseId) internal {
        House storage h = houses[houseId];
        if (h.occupants >= capacityOf(h.tier)) revert HouseFull();
        h.occupants++;
        houseOf[petId] = houseId;
        emit MovedIn(petId, houseId);
    }

    /// @dev Zufriedenheit festschreiben, Platz freigeben. No-op wenn nicht untergebracht.
    function _leave(uint256 petId) internal {
        uint256 houseId = houseOf[petId];
        if (houseId == 0) return;
        _mood[petId] = Mood(uint8(moodOf(petId)), uint64(block.timestamp));
        houses[houseId].occupants--;
        delete houseOf[petId];
        emit MovedOut(petId, houseId);
    }

    /// @dev Haus nur uebertragbar, wenn leer: sonst wuerden fremde Pets beim Kaeufer wohnen.
    function _update(address to, uint256 tokenId, address auth) internal override returns (address) {
        address from = _ownerOf(tokenId);
        if (from != address(0) && houses[tokenId].occupants != 0) revert HouseNotEmpty();
        return super._update(to, tokenId, auth);
    }

    // ------------------------------------------------------------------ Metadaten

    function tokenURI(uint256 houseId) public view override returns (string memory) {
        _requireOwned(houseId);
        House memory h = houses[houseId];
        string memory json = string.concat(
            '{"name":"',
            tierName(h.tier),
            " #",
            Strings.toString(houseId),
            '","description":"Physisches 3D-Haus mit NFC-Chip. Pets wohnen hier; Pflege nur nach Scan.","attributes":[',
            '{"trait_type":"Stufe","value":"',
            tierName(h.tier),
            '"},{"trait_type":"Plaetze","value":',
            Strings.toString(capacityOf(h.tier)),
            '},{"trait_type":"Zufriedenheit pro Tag","value":-',
            Strings.toString(decayPerDay(h.tier)),
            "}]}"
        );
        return string.concat("data:application/json;base64,", Base64.encode(bytes(json)));
    }
}
