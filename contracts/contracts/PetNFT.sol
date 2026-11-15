// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {ERC721} from "@openzeppelin/contracts/token/ERC721/ERC721.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {IERC6551Registry} from "./erc6551/IERC6551.sol";
import {PetAccount} from "./PetAccount.sol";
import {GameMath} from "./lib/GameMath.sol";
import {Pet} from "./lib/PetTypes.sol";

interface ITrophyMigrate {
    function migrate(address from, address to) external;
}

interface ICosmeticsView {
    function balanceOf(address account, uint256 id) external view returns (uint256);
    function items(uint256 id) external view returns (string memory name, uint128 price, uint64 maxSupply, uint64 minted);
}

interface IPetRenderer {
    function tokenURI(uint256 id, Pet memory p, uint256 itemId, string memory itemName) external view returns (string memory);
}

/// @title PetNFT – das Tier selbst (ERC-721) inkl. Stats, XP-Loop und Fusion
/// @notice Jedes Pet bekommt beim Mint eine eigene ERC-6551 Wallet (PetAccount).
/// @dev Stats liegen hier (nicht im TBA): Die Spiellogik braucht eine autoritative Quelle,
///      und da sie an der tokenId haengen, wechseln sie beim Verkauf trotzdem automatisch mit.
contract PetNFT is ERC721, Ownable, ReentrancyGuard {
    /// Reihenfolge = Stat-Index (STR, AGI, INT, VIT)
    enum Action {
        Train,
        Play,
        Puzzle,
        Feed
    }

    uint256 public constant XP_PER_ACTION = 20;
    uint256 public constant MAX_ITEM_ID = 32; // Cosmetics-IDs 1..32 (fuer Inventar-Migration)
    uint256 public constant GENE_SLOTS = 8; // Anzahl 16-Bit-Gene in der DNA (siehe PetRenderer)
    uint256 public constant MUTATION_RATE = 16; // 1/16 Chance pro Gen, bei Fusion neu zu wuerfeln

    IERC6551Registry public immutable registry;
    address public immutable accountImpl;
    uint256 public immutable mintPrice;
    uint256 public immutable cooldown; // Sekunden zwischen Aktionen
    uint256 public immutable maxActionsPerDay;

    address public cosmetics;
    address public trophy;
    /// @notice Bild/Metadaten-Generator. Austauschbar (Kunst kann sich weiterentwickeln, Spielwerte nicht).
    IPetRenderer public renderer;

    uint256 private _nextId = 1;
    mapping(uint256 => Pet) private _pets;

    event Minted(address indexed owner, uint256 indexed petId, address account);
    event Interacted(uint256 indexed petId, Action action, uint256 level, uint256 xp);
    event LevelUp(uint256 indexed petId, uint256 newLevel, uint8 focusStat);
    event Fused(uint256 indexed keepId, uint256 indexed burnId, uint256 newLevel, uint8 fusionCount);
    event Equipped(uint256 indexed petId, uint8 itemId);
    event RendererChanged(address renderer);

    error WrongPayment();
    error NotPetOwner();
    error Cooldown();
    error DailyLimit();
    error MaxLevel();
    error FusionNotAllowed();
    error SelfOwnership();
    error AlreadyConfigured();
    error ItemNotOwned();

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

    /// @dev Trust-Trade-off: Owner kann das Aussehen aendern, aber nie Stats, Level oder Besitz.
    function setRenderer(IPetRenderer renderer_) external onlyOwner {
        renderer = renderer_;
        emit RendererChanged(address(renderer_));
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
        // Reinrassig: Ohren- (Slot 2) und Schwanz-Gen (Slot 7) = Spezies-Gen (Slot 1).
        // Mischlinge entstehen erst durch Fusion (slotweise Vererbung).
        uint256 dna = uint256(keccak256(abi.encode(seed, "dna")));
        uint256 sp = (dna >> 16) & 0xffff;
        dna &= ~((uint256(0xffff) << 32) | (uint256(0xffff) << 112));
        p.dna = dna | (sp << 32) | (sp << 112);

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

    // ------------------------------------------------------------------ Cosmetics anziehen

    /// @notice Cosmetic sichtbar am Pet tragen (on-chain -> erscheint im NFT-Bild auf jedem Marktplatz).
    /// @dev Item muss in der Pet-Wallet liegen. Wird es spaeter entfernt, verschwindet es aus dem Bild
    ///      (tokenURI prueft den Bestand live). 0 = ausziehen.
    function equip(uint256 petId, uint8 itemId) external {
        if (ownerOf(petId) != msg.sender) revert NotPetOwner();
        if (itemId != 0 && ICosmeticsView(cosmetics).balanceOf(accountOf(petId), itemId) == 0) revert ItemNotOwned();
        _pets[petId].equipped = itemId;
        emit Equipped(petId, itemId);
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
        k.dna = _mixDna(k.dna, b.dna, keepId, burnId);

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

    // ------------------------------------------------------------------ Genetik

    /// @notice Gen-Vererbung: jedes Gen kommt zufaellig von einem Elternteil, mit 1/16 Mutationschance.
    /// @dev Zufall aus prevrandao/blockhash: beeinflussbar, aber nur fuers Aussehen relevant (nicht fuer Stats).
    function _mixDna(uint256 a, uint256 b, uint256 keepId, uint256 burnId) internal view returns (uint256 child) {
        uint256 r = uint256(keccak256(abi.encode(a, b, keepId, burnId, block.prevrandao, blockhash(block.number - 1))));
        uint256 fresh = uint256(keccak256(abi.encode(r, "mutation")));
        child = a;
        for (uint256 i = 0; i < GENE_SLOTS; ++i) {
            uint256 mask = uint256(0xffff) << (16 * i);
            uint256 pickB = (r >> i) & 1;
            uint256 mutate = (r >> (32 + 4 * i)) % MUTATION_RATE == 0 ? 1 : 0;
            uint256 src = mutate == 1 ? fresh : pickB == 1 ? b : a;
            child = (child & ~mask) | (src & mask);
        }
    }

    // ------------------------------------------------------------------ Metadaten (on-chain)

    function tokenURI(uint256 petId) public view override returns (string memory) {
        _requireOwned(petId);
        Pet memory p = _pets[petId];
        uint256 item = p.equipped;
        string memory itemName;
        if (item != 0 && ICosmeticsView(cosmetics).balanceOf(accountOf(petId), item) > 0) {
            (itemName,,,) = ICosmeticsView(cosmetics).items(item);
        } else {
            item = 0;
        }
        return renderer.tokenURI(petId, p, item, itemName);
    }

    function _min(uint256 a, uint256 b) private pure returns (uint256) {
        return a < b ? a : b;
    }
}
