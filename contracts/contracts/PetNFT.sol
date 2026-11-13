// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {ERC721} from "@openzeppelin/contracts/token/ERC721/ERC721.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {Strings} from "@openzeppelin/contracts/utils/Strings.sol";
import {Base64} from "@openzeppelin/contracts/utils/Base64.sol";
import {IERC6551Registry} from "./erc6551/IERC6551.sol";
import {PetAccount} from "./PetAccount.sol";
import {GameMath} from "./lib/GameMath.sol";

interface ITrophyMigrate {
    function migrate(address from, address to) external;
}

/// @title PetNFT – das Tier selbst (ERC-721) inkl. Stats, XP-Loop und Fusion
/// @notice Jedes Pet bekommt beim Mint eine eigene ERC-6551 Wallet (PetAccount).
/// @dev Stats liegen hier (nicht im TBA): Die Spiellogik braucht eine autoritative Quelle,
///      und da sie an der tokenId haengen, wechseln sie beim Verkauf trotzdem automatisch mit.
contract PetNFT is ERC721, Ownable, ReentrancyGuard {
    using Strings for uint256;

    /// Reihenfolge = Stat-Index (STR, AGI, INT, VIT)
    enum Action {
        Train,
        Play,
        Puzzle,
        Feed
    }

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
        uint8 species;
    }

    uint256 public constant XP_PER_ACTION = 20;
    uint256 public constant MAX_ITEM_ID = 32; // Cosmetics-IDs 1..32 (fuer Inventar-Migration)

    IERC6551Registry public immutable registry;
    address public immutable accountImpl;
    uint256 public immutable mintPrice;
    uint256 public immutable cooldown; // Sekunden zwischen Aktionen
    uint256 public immutable maxActionsPerDay;

    address public cosmetics;
    address public trophy;

    uint256 private _nextId = 1;
    mapping(uint256 => Pet) private _pets;

    event Minted(address indexed owner, uint256 indexed petId, address account);
    event Interacted(uint256 indexed petId, Action action, uint256 level, uint256 xp);
    event LevelUp(uint256 indexed petId, uint256 newLevel, uint8 focusStat);
    event Fused(uint256 indexed keepId, uint256 indexed burnId, uint256 newLevel, uint8 fusionCount);

    error WrongPayment();
    error NotPetOwner();
    error Cooldown();
    error DailyLimit();
    error MaxLevel();
    error FusionNotAllowed();
    error SelfOwnership();
    error AlreadyConfigured();

    constructor(
        IERC6551Registry registry_,
        address accountImpl_,
        uint256 mintPrice_,
        uint256 cooldown_,
        uint256 maxActionsPerDay_
    ) ERC721("BLD Pet", "BPET") Ownable(msg.sender) {
        registry = registry_;
        accountImpl = accountImpl_;
        mintPrice = mintPrice_;
        cooldown = cooldown_;
        maxActionsPerDay = maxActionsPerDay_;
    }

    /// @notice Einmalig nach Deploy: Cosmetics- und Trophy-Contract verknuepfen.
    function setGameContracts(address cosmetics_, address trophy_) external onlyOwner {
        if (cosmetics != address(0)) revert AlreadyConfigured();
        cosmetics = cosmetics_;
        trophy = trophy_;
    }

    // ------------------------------------------------------------------ Mint

    function mint() external payable returns (uint256 petId) {
        if (msg.value != mintPrice) revert WrongPayment();
        petId = _nextId++;

        // Pseudo-Zufall: fuer Start-Stats (5..15) akzeptabel, da wertarm.
        // Schwaeche: Miner/Validator koennte beeinflussen -> im Turnier darum Commit-Reveal.
        uint256 seed = uint256(keccak256(abi.encode(blockhash(block.number - 1), block.prevrandao, msg.sender, petId)));
        Pet storage p = _pets[petId];
        for (uint256 i = 0; i < 4; ++i) {
            p.stats[i] = uint16(5 + (seed >> (i * 16)) % 11);
        }
        p.level = 1;
        p.generation = 1;
        p.species = uint8((seed >> 64) % 4);

        _safeMint(msg.sender, petId);
        address acc = registry.createAccount(accountImpl, bytes32(0), block.chainid, address(this), petId);
        emit Minted(msg.sender, petId, acc);
    }

    function accountOf(uint256 petId) public view returns (address) {
        return registry.account(accountImpl, bytes32(0), block.chainid, address(this), petId);
    }

    function getPet(uint256 petId) external view returns (Pet memory) {
        _requireOwned(petId);
        return _pets[petId];
    }

    function exists(uint256 petId) external view returns (bool) {
        return _ownerOf(petId) != address(0);
    }

    function totalMinted() external view returns (uint256) {
        return _nextId - 1;
    }

    // ------------------------------------------------------------------ Pflege-Loop

    /// @notice Pflegen: +20 XP, zaehlt fuer den Fokus-Stat des naechsten Level-Ups.
    function interact(uint256 petId, Action action) external {
        if (ownerOf(petId) != msg.sender) revert NotPetOwner();
        Pet storage p = _pets[petId];
        if (p.level >= GameMath.MAX_LEVEL) revert MaxLevel();
        if (block.timestamp < p.lastAction + cooldown) revert Cooldown();

        if (block.timestamp >= p.dayStart + 1 days) {
            p.dayStart = uint64(block.timestamp);
            p.actionsToday = 0;
        }
        if (p.actionsToday >= maxActionsPerDay) revert DailyLimit();

        p.actionsToday++;
        p.lastAction = uint64(block.timestamp);
        p.focus[uint8(action)]++;

        uint256 xp = p.xp + XP_PER_ACTION;
        uint256 level = p.level;
        while (level < GameMath.MAX_LEVEL && xp >= GameMath.xpToNext(level)) {
            xp -= GameMath.xpToNext(level);
            level++;
            _levelUp(petId, p, level);
        }
        p.level = uint16(level);
        p.xp = uint32(level == GameMath.MAX_LEVEL ? 0 : xp);
        emit Interacted(petId, action, level, p.xp);
    }

    /// @dev Alle Stats +1, Fokus-Stat (meistgenutzte Aktion) zusaetzlich +2.
    function _levelUp(uint256 petId, Pet storage p, uint256 newLevel) internal {
        uint8 best;
        for (uint8 i = 1; i < 4; ++i) {
            if (p.focus[i] > p.focus[best]) best = i;
        }
        for (uint256 i = 0; i < 4; ++i) {
            uint256 add = i == best ? 3 : 1;
            p.stats[i] = uint16(_min(p.stats[i] + add, GameMath.STAT_CAP));
            p.focus[i] = 0;
        }
        emit LevelUp(petId, newLevel, best);
    }

    // ------------------------------------------------------------------ Fusion 2 -> 1

    /// @notice Verschmilzt `burnId` in `keepId`. Inventar und Trophaeen wandern ins TBA von keepId.
    /// @dev Reihenfolge wichtig: ERST migrieren, DANN burnen. Nach dem Burn hat das TBA von burnId
    ///      keinen Owner mehr -> alles was dann noch drin liegt, waere fuer immer gesperrt.
    function fuse(uint256 keepId, uint256 burnId) external nonReentrant {
        if (keepId == burnId) revert FusionNotAllowed();
        if (ownerOf(keepId) != msg.sender || ownerOf(burnId) != msg.sender) revert NotPetOwner();
        Pet storage k = _pets[keepId];
        Pet storage b = _pets[burnId];
        if (k.level < GameMath.FUSION_MIN_LEVEL || b.level < GameMath.FUSION_MIN_LEVEL) revert FusionNotAllowed();

        // 1) Inventar-Migration (ERC-6551)
        address keepAcc = accountOf(keepId);
        address burnAcc = accountOf(burnId);
        PetAccount(payable(burnAcc)).sweepTo(keepAcc, cosmetics, MAX_ITEM_ID);
        ITrophyMigrate(trophy).migrate(burnAcc, keepAcc);

        // 2) Vererbung (fusionCount = max beider -> kein "Waschen" ueber frische Pets)
        uint256 fc = k.fusionCount > b.fusionCount ? k.fusionCount : b.fusionCount;
        k.stats = GameMath.fuseStats(k.stats, b.stats, fc);
        (uint256 lvl, uint256 rem) =
            GameMath.fuseXp(GameMath.totalXp(k.level, k.xp), GameMath.totalXp(b.level, b.xp));
        k.level = uint16(lvl);
        k.xp = uint32(rem);
        k.fusionCount = uint8(fc + 1);
        k.generation = (k.generation > b.generation ? k.generation : b.generation) + 1;
        k.focus = [uint8(0), 0, 0, 0];

        // 3) Burn = Token-Sink
        delete _pets[burnId];
        _burn(burnId);

        emit Fused(keepId, burnId, k.level, k.fusionCount);
    }

    // ------------------------------------------------------------------ Admin

    function withdraw(address payable to) external onlyOwner {
        (bool ok,) = to.call{value: address(this).balance}("");
        require(ok, "withdraw failed");
    }

    // ------------------------------------------------------------------ Transfer-Guard

    /// @dev Pet darf nicht in seine eigene Wallet transferiert werden: Owner(TBA) = TBA -> Zyklus,
    ///      niemand koennte je wieder signieren -> Pet + Inventar fuer immer gesperrt.
    function _update(address to, uint256 tokenId, address auth) internal override returns (address) {
        if (to != address(0) && to == accountOf(tokenId)) revert SelfOwnership();
        return super._update(to, tokenId, auth);
    }

    // ------------------------------------------------------------------ Metadaten (on-chain)

    function tokenURI(uint256 petId) public view override returns (string memory) {
        _requireOwned(petId);
        Pet memory p = _pets[petId];
        string memory json = string.concat(
            '{"name":"BLD Pet #',
            petId.toString(),
            '","description":"Phygitales Web3-Tamagotchi (ZHAW BDL HS26)","image":"data:image/svg+xml;base64,',
            Base64.encode(bytes(_svg(petId, p))),
            '","attributes":',
            _attributes(p),
            "}"
        );
        return string.concat("data:application/json;base64,", Base64.encode(bytes(json)));
    }

    function _attributes(Pet memory p) internal pure returns (string memory) {
        return string.concat(
            '[{"trait_type":"Level","value":',
            uint256(p.level).toString(),
            '},{"trait_type":"STR","value":',
            uint256(p.stats[0]).toString(),
            '},{"trait_type":"AGI","value":',
            uint256(p.stats[1]).toString(),
            '},{"trait_type":"INT","value":',
            uint256(p.stats[2]).toString(),
            '},{"trait_type":"VIT","value":',
            uint256(p.stats[3]).toString(),
            '},{"trait_type":"Generation","value":',
            uint256(p.generation).toString(),
            "}]"
        );
    }

    function _svg(uint256 petId, Pet memory p) internal pure returns (string memory) {
        string[4] memory colors = ["#f6c177", "#9ccfd8", "#c4a7e7", "#eb6f92"];
        return string.concat(
            '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 200 200"><rect width="200" height="200" fill="#1f1d2e"/>',
            '<circle cx="100" cy="95" r="55" fill="',
            colors[p.species],
            '"/><circle cx="80" cy="85" r="7" fill="#191724"/><circle cx="120" cy="85" r="7" fill="#191724"/>',
            '<text x="100" y="180" text-anchor="middle" font-family="monospace" font-size="16" fill="#e0def4">#',
            petId.toString(),
            " Lv ",
            uint256(p.level).toString(),
            "</text></svg>"
        );
    }

    function _min(uint256 a, uint256 b) private pure returns (uint256) {
        return a < b ? a : b;
    }
}
