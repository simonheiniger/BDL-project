// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {ERC721} from "@openzeppelin/contracts/token/ERC721/ERC721.sol";
import {ERC721Enumerable} from "@openzeppelin/contracts/token/ERC721/extensions/ERC721Enumerable.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {Strings} from "@openzeppelin/contracts/utils/Strings.sol";
import {Base64} from "@openzeppelin/contracts/utils/Base64.sol";

/// @title Trophy – Siegerurkunden als Soulbound Token (ERC-5192-artig)
/// @notice Wird ins TBA des Gewinner-Pets gemintet. Nicht handelbar -> nachweisbare Historie des Pets.
///         Da das TBA am Pet haengt, wandert die Urkunde beim Verkauf des Pets trotzdem mit.
///         Einzige Ausnahme vom Soulbound: Migration bei Fusion (nur PetNFT).
contract Trophy is ERC721Enumerable, Ownable {
    using Strings for uint256;

    struct Info {
        uint64 tournamentId;
        bytes8 zone; // Geohash-Praefix
        uint64 timestamp;
        uint16 entrants;
    }

    address public minter; // Arena
    address public migrator; // PetNFT
    mapping(uint256 => Info) public info;
    uint256 private _nextId = 1;
    bool private _migrating;

    /// @dev ERC-5192
    event Locked(uint256 tokenId);

    error Soulbound();
    error NotAuthorized();

    constructor() ERC721("BLD Pet Trophy", "BTRO") Ownable(msg.sender) {}

    function setRoles(address minter_, address migrator_) external onlyOwner {
        minter = minter_;
        migrator = migrator_;
    }

    function mint(address to, uint64 tournamentId, bytes8 zone, uint16 entrants) external returns (uint256 id) {
        if (msg.sender != minter) revert NotAuthorized();
        id = _nextId++;
        info[id] = Info(tournamentId, zone, uint64(block.timestamp), entrants);
        _mint(to, id);
        emit Locked(id);
    }

    /// @notice Alle Trophaeen von `from` nach `to` (Fusion: TBA des verbrannten -> TBA des behaltenen Pets).
    function migrate(address from, address to) external {
        if (msg.sender != migrator) revert NotAuthorized();
        _migrating = true;
        for (uint256 n = balanceOf(from); n > 0; --n) {
            _transfer(from, to, tokenOfOwnerByIndex(from, n - 1));
        }
        _migrating = false;
    }

    /// @dev ERC-5192: immer gesperrt
    function locked(uint256 tokenId) external view returns (bool) {
        _requireOwned(tokenId);
        return true;
    }

    function _update(address to, uint256 tokenId, address auth) internal override returns (address) {
        address from = _ownerOf(tokenId);
        if (from != address(0) && !_migrating) revert Soulbound();
        return super._update(to, tokenId, auth);
    }

    function tokenURI(uint256 id) public view override returns (string memory) {
        _requireOwned(id);
        Info memory i = info[id];
        string memory json = string.concat(
            '{"name":"Trophy #',
            id.toString(),
            '","description":"Siegerurkunde Turnier #',
            uint256(i.tournamentId).toString(),
            '","attributes":[{"trait_type":"Zone","value":"',
            _zoneString(i.zone),
            '"},{"trait_type":"Teilnehmer","value":',
            uint256(i.entrants).toString(),
            '},{"display_type":"date","trait_type":"Datum","value":',
            uint256(i.timestamp).toString(),
            "}]}"
        );
        return string.concat("data:application/json;base64,", Base64.encode(bytes(json)));
    }

    /// @dev bytes8 -> String ohne abschliessende Null-Bytes (sonst ungueltiges JSON)
    function _zoneString(bytes8 z) internal pure returns (string memory) {
        uint256 len;
        while (len < 8 && z[len] != 0) ++len;
        bytes memory out = new bytes(len);
        for (uint256 i = 0; i < len; ++i) out[i] = z[i];
        return string(out);
    }

    function supportsInterface(bytes4 interfaceId) public view override returns (bool) {
        return interfaceId == 0xb45a3c0e /* ERC-5192 */ || super.supportsInterface(interfaceId);
    }
}
