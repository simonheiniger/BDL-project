// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {EIP712} from "@openzeppelin/contracts/utils/cryptography/EIP712.sol";
import {ECDSA} from "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";
import {PetNFT} from "./PetNFT.sol";
import {Trophy} from "./Trophy.sol";
import {GameMath} from "./lib/GameMath.sol";
import {Pet} from "./lib/PetTypes.sol";

/// @title Arena – regionale Turniere mit Geofence-Check-in und gewichtetem Zufall
/// @notice Ablauf: create (Seed-Commit) -> join (signierter Check-in) -> close (Blockhash fixieren)
///         -> reveal (Seed offenlegen, Gewinner ziehen, Trophy ins TBA) | refund (falls kein Reveal).
/// @dev Der Standort selbst kommt NIE on-chain (Ledger ist oeffentlich). On-chain nur Zone + Zeitfenster;
///      der Check-in-Service bestaetigt "Spieler war in Zone" per EIP-712-Signatur.
contract Arena is EIP712, Ownable, ReentrancyGuard {
    enum Status {
        None,
        Open,
        Closed,
        Settled,
        Refunded
    }

    struct Tournament {
        bytes8 zone; // Geohash-Praefix, z.B. "u0qj8b" (~1.2 km)
        uint64 start;
        uint64 end;
        uint96 entryFee;
        bytes32 seedCommit; // keccak256(abi.encode(seed))
        address organizer;
        address host; // Venue, bekommt 20 % des Pools
        uint64 closeBlock;
        Status status;
        uint8 challenge;
        uint256 winnerPet;
    }

    struct Entry {
        uint256 petId;
        address player;
        uint16[4] stats; // Snapshot beim Join -> kein Nach-Leveln nach Anmeldung
        uint16 level;
    }

    struct Challenge {
        string name;
        uint16[4] weights; // STR, AGI, INT, VIT; Summe 100
    }

    bytes32 public constant CHECKIN_TYPEHASH =
        keccak256("CheckIn(address player,uint256 petId,uint256 tournamentId,uint256 expiry)");
    uint256 public constant MAX_ENTRANTS = 32; // Gas O(N) beim Reveal; groesser -> Merkle-Variante (Konzept)
    uint256 public constant REVEAL_WINDOW = 200; // < 256, sonst ist blockhash() nicht mehr verfuegbar
    uint256 public constant PRIZE_BP = 7000;
    uint256 public constant HOST_BP = 2000; // Rest (10 %) -> Treasury

    PetNFT public immutable pets;
    Trophy public immutable trophy;
    address public checkinSigner;

    Challenge[] public challenges;
    uint256 public tournamentCount;
    mapping(uint256 => Tournament) public tournaments;
    mapping(uint256 => Entry[]) private _entries;
    mapping(uint256 => mapping(uint256 => bool)) public petJoined;
    mapping(uint256 => mapping(address => bool)) public playerJoined;
    mapping(address => uint256) public pending; // Pull-Payments

    event TournamentCreated(uint256 indexed id, bytes8 zone, uint64 start, uint64 end, uint96 entryFee, address host);
    event Joined(uint256 indexed id, uint256 indexed petId, address indexed player);
    event Closed(uint256 indexed id, uint64 closeBlock);
    event Settled(uint256 indexed id, uint256 indexed winnerPet, uint8 challenge, uint256 rand, uint256 trophyId);
    event Refunded(uint256 indexed id);

    error BadParams();
    error WrongStatus();
    error NotInWindow();
    error AlreadyJoined();
    error Full();
    error BadSignature();
    error WrongPayment();
    error BadReveal();

    constructor(PetNFT pets_, Trophy trophy_, address checkinSigner_)
        EIP712("BDL Pet Arena", "1")
        Ownable(msg.sender)
    {
        pets = pets_;
        trophy = trophy_;
        checkinSigner = checkinSigner_;
        _addChallenge("Sprint", [uint16(20), 50, 0, 30]);
        _addChallenge("Kraftprobe", [uint16(60), 10, 0, 30]);
        _addChallenge("Raetsel", [uint16(0), 20, 70, 10]);
        _addChallenge("Ausdauer", [uint16(20), 20, 10, 50]);
    }

    // ------------------------------------------------------------------ Admin

    function setCheckinSigner(address s) external onlyOwner {
        checkinSigner = s;
    }

    function addChallenge(string calldata name, uint16[4] calldata weights) external onlyOwner {
        _addChallenge(name, weights);
    }

    function _addChallenge(string memory name, uint16[4] memory w) internal {
        if (uint256(w[0]) + w[1] + w[2] + w[3] != 100) revert BadParams();
        challenges.push(Challenge(name, w));
    }

    // ------------------------------------------------------------------ Lebenszyklus

    /// @notice Jeder (z.B. eine Venue) kann ein Turnier anlegen. Der Seed bleibt geheim, nur der Hash geht on-chain.
    function createTournament(
        bytes8 zone,
        uint64 start,
        uint64 end,
        uint96 entryFee,
        bytes32 seedCommit,
        address host
    ) external returns (uint256 id) {
        if (end <= start || end <= block.timestamp || seedCommit == bytes32(0) || host == address(0)) {
            revert BadParams();
        }
        id = ++tournamentCount;
        Tournament storage t = tournaments[id];
        t.zone = zone;
        t.start = start;
        t.end = end;
        t.entryFee = entryFee;
        t.seedCommit = seedCommit;
        t.organizer = msg.sender;
        t.host = host;
        t.status = Status.Open;
        emit TournamentCreated(id, zone, start, end, entryFee, host);
    }

    /// @param sig EIP-712 Signatur des Check-in-Service ueber (player, petId, tournamentId, expiry)
    function join(uint256 id, uint256 petId, uint256 expiry, bytes calldata sig) external payable {
        Tournament storage t = tournaments[id];
        if (t.status != Status.Open) revert WrongStatus();
        if (block.timestamp < t.start || block.timestamp > t.end) revert NotInWindow();
        if (msg.value != t.entryFee) revert WrongPayment();
        if (pets.ownerOf(petId) != msg.sender) revert BadParams();
        if (petJoined[id][petId] || playerJoined[id][msg.sender]) revert AlreadyJoined();
        if (_entries[id].length >= MAX_ENTRANTS) revert Full();
        if (block.timestamp > expiry) revert BadSignature();

        bytes32 digest = _hashTypedDataV4(keccak256(abi.encode(CHECKIN_TYPEHASH, msg.sender, petId, id, expiry)));
        if (ECDSA.recover(digest, sig) != checkinSigner) revert BadSignature();

        petJoined[id][petId] = true;
        playerJoined[id][msg.sender] = true;
        Pet memory p = pets.getPet(petId);
        _entries[id].push(Entry(petId, msg.sender, p.stats, p.level));
        emit Joined(id, petId, msg.sender);
    }

    /// @notice Nach Anmeldeschluss: fixiert den Block, dessen Hash in den Zufall eingeht.
    ///         Dieser Hash ist beim Seed-Commit noch unbekannt -> Organizer kann Ergebnis nicht vorab berechnen.
    function close(uint256 id) external {
        Tournament storage t = tournaments[id];
        if (t.status != Status.Open) revert WrongStatus();
        if (block.timestamp <= t.end) revert NotInWindow();
        t.status = Status.Closed;
        t.closeBlock = uint64(block.number);
        emit Closed(id, t.closeBlock);
    }

    /// @notice Seed offenlegen -> Challenge + Gewinner werden deterministisch daraus berechnet.
    function reveal(uint256 id, bytes32 seed) external nonReentrant {
        Tournament storage t = tournaments[id];
        if (t.status != Status.Closed) revert WrongStatus();
        if (block.number <= t.closeBlock || block.number > t.closeBlock + REVEAL_WINDOW) revert NotInWindow();
        if (keccak256(abi.encode(seed)) != t.seedCommit) revert BadReveal();

        uint256 rand = uint256(keccak256(abi.encode(seed, blockhash(t.closeBlock), id)));
        uint8 ch = uint8(rand % challenges.length);
        t.challenge = ch;

        Entry[] storage es = _entries[id];
        uint256[] memory powers = new uint256[](es.length);
        uint16[4] memory w = challenges[ch].weights;
        for (uint256 i = 0; i < es.length; ++i) {
            // verbrannte Pets (Fusion nach Join) nehmen nicht teil
            if (pets.exists(es[i].petId)) powers[i] = GameMath.power(es[i].stats, es[i].level, w);
        }
        (uint256 idx,) = GameMath.weightedPick(powers, uint256(keccak256(abi.encode(rand, "pick"))));

        uint256 pool = uint256(t.entryFee) * es.length;
        if (idx == type(uint256).max) {
            // kein gueltiger Teilnehmer -> alle zurueckerstatten
            _refundAll(id, t);
            return;
        }

        t.status = Status.Settled;
        uint256 winnerPet = es[idx].petId;
        t.winnerPet = winnerPet;
        address winnerAcc = pets.accountOf(winnerPet);
        uint256 trophyId = trophy.mint(winnerAcc, uint64(id), t.zone, uint16(es.length));

        uint256 prize = (pool * PRIZE_BP) / 10_000;
        uint256 hostCut = (pool * HOST_BP) / 10_000;
        pending[t.host] += hostCut;
        pending[owner()] += pool - prize - hostCut;
        emit Settled(id, winnerPet, ch, rand, trophyId);

        // Preisgeld geht ins TBA des Pets (nicht an den Spieler): bleibt beim Pet, auch nach Verkauf.
        if (prize > 0) {
            (bool ok,) = winnerAcc.call{value: prize}("");
            if (!ok) pending[es[idx].player] += prize;
        }
    }

    /// @notice Liveness-Schutz: Reveal ausgeblieben -> jeder kann Refund ausloesen.
    function refund(uint256 id) external {
        Tournament storage t = tournaments[id];
        if (t.status != Status.Closed) revert WrongStatus();
        if (block.number <= t.closeBlock + REVEAL_WINDOW) revert NotInWindow();
        _refundAll(id, t);
    }

    function withdraw() external nonReentrant {
        uint256 amt = pending[msg.sender];
        pending[msg.sender] = 0;
        (bool ok,) = msg.sender.call{value: amt}("");
        require(ok, "withdraw failed");
    }

    function _refundAll(uint256 id, Tournament storage t) internal {
        t.status = Status.Refunded;
        Entry[] storage es = _entries[id];
        for (uint256 i = 0; i < es.length; ++i) {
            pending[es[i].player] += t.entryFee;
        }
        emit Refunded(id);
    }

    // ------------------------------------------------------------------ Views

    function getEntries(uint256 id) external view returns (Entry[] memory) {
        return _entries[id];
    }

    function challengeCount() external view returns (uint256) {
        return challenges.length;
    }

    function getChallenge(uint256 i) external view returns (string memory name, uint16[4] memory weights) {
        Challenge storage c = challenges[i];
        return (c.name, c.weights);
    }

    function domainSeparator() external view returns (bytes32) {
        return _domainSeparatorV4();
    }
}
