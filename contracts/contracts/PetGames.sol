// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {EIP712} from "@openzeppelin/contracts/utils/cryptography/EIP712.sol";
import {ECDSA} from "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";

interface IPetGameTarget {
    function ownerOf(uint256 petId) external view returns (address);
    function gameXp(uint256 petId, uint256 amount, uint8 focusStat) external;
}

/// @title PetGames – XP aus Minispielen (Memory, Quiz, Rennen) per signiertem Gutschein
/// @notice Gespielt wird off-chain in der App (keine Transaktion). Der Spiele-Server prueft das Ergebnis und signiert
///         einen Gutschein (EIP-712). Spieler sammeln Gutscheine und loesen sie gebuendelt mit EINER Transaktion ein.
/// @dev Vertrauensannahme: Der Spiele-Server ist ein Orakel – wer seinen Key hat, kann Gutscheine erzeugen.
///      Schadensbegrenzung on-chain: max. XP pro Gutschein und pro Pet und Tag, jeder Gutschein nur einmal.
contract PetGames is EIP712, Ownable {
    struct Voucher {
        address player;
        uint256 petId;
        uint8 kind; // 0 Memory, 1 Quiz, 2 Rennen
        uint16 xp;
        uint256 nonce; // vom Server pro Spielrunde vergeben
        uint64 expiry;
    }

    bytes32 public constant VOUCHER_TYPEHASH =
        keccak256("Voucher(address player,uint256 petId,uint8 kind,uint16 xp,uint256 nonce,uint64 expiry)");
    uint256 public constant MAX_XP_PER_VOUCHER = 40;
    uint256 public constant MAX_XP_PER_DAY = 200; // ~ 10 Pflege-Aktionen: Spiele ergaenzen die Pflege, ersetzen sie nicht

    IPetGameTarget public immutable pets;
    address public signer;

    mapping(uint256 => bool) public used; // nonce -> eingeloest
    mapping(uint256 => uint256) public dayOf; // petId -> Tag (block.timestamp / 1 days)
    mapping(uint256 => uint256) public xpToday; // petId -> bereits gutgeschriebene Spiel-XP an diesem Tag

    event Claimed(uint256 indexed petId, address indexed player, uint8 kind, uint256 nonce, uint256 credited);
    event SignerChanged(address signer);

    error BadLength();
    error NotPlayer();
    error NotPetOwner();
    error Expired();
    error AlreadyUsed();
    error TooMuchXp();
    error BadSignature();

    constructor(IPetGameTarget pets_, address signer_) EIP712("BDL Pet Games", "1") Ownable(msg.sender) {
        pets = pets_;
        signer = signer_;
    }

    function setSigner(address s) external onlyOwner {
        signer = s;
        emit SignerChanged(s);
    }

    /// @notice Mehrere Gutscheine mit einer Transaktion einloesen. Ueber dem Tageslimit wird gekappt (nicht revertiert),
    ///         damit ein Stapel nicht wegen eines einzelnen Gutscheins scheitert.
    function claim(Voucher[] calldata vs, bytes[] calldata sigs) external returns (uint256 total) {
        if (vs.length == 0 || vs.length != sigs.length) revert BadLength();
        uint256 today = block.timestamp / 1 days;
        for (uint256 i = 0; i < vs.length; ++i) {
            Voucher calldata v = vs[i];
            if (v.player != msg.sender) revert NotPlayer();
            if (pets.ownerOf(v.petId) != msg.sender) revert NotPetOwner();
            if (block.timestamp > v.expiry) revert Expired();
            if (used[v.nonce]) revert AlreadyUsed();
            if (v.xp > MAX_XP_PER_VOUCHER) revert TooMuchXp();
            bytes32 digest = _hashTypedDataV4(
                keccak256(abi.encode(VOUCHER_TYPEHASH, v.player, v.petId, v.kind, v.xp, v.nonce, v.expiry))
            );
            if (ECDSA.recover(digest, sigs[i]) != signer) revert BadSignature();
            used[v.nonce] = true;

            if (dayOf[v.petId] != today) {
                dayOf[v.petId] = today;
                xpToday[v.petId] = 0;
            }
            uint256 room = MAX_XP_PER_DAY - xpToday[v.petId];
            uint256 credit = v.xp < room ? v.xp : room;
            if (credit > 0) {
                xpToday[v.petId] += credit;
                // Memory/Quiz trainieren INT (Index 2), Rennen AGI (Index 1)
                pets.gameXp(v.petId, credit, v.kind == 2 ? 1 : 2);
                total += credit;
            }
            emit Claimed(v.petId, msg.sender, v.kind, v.nonce, credit);
        }
    }

    function domainSeparator() external view returns (bytes32) {
        return _domainSeparatorV4();
    }
}
