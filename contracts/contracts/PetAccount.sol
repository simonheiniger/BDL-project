// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {IERC165} from "@openzeppelin/contracts/utils/introspection/IERC165.sol";
import {IERC721} from "@openzeppelin/contracts/token/ERC721/IERC721.sol";
import {IERC1155} from "@openzeppelin/contracts/token/ERC1155/IERC1155.sol";
import {IERC1271} from "@openzeppelin/contracts/interfaces/IERC1271.sol";
import {ERC721Holder} from "@openzeppelin/contracts/token/ERC721/utils/ERC721Holder.sol";
import {ERC1155Holder} from "@openzeppelin/contracts/token/ERC1155/utils/ERC1155Holder.sol";
import {SignatureChecker} from "@openzeppelin/contracts/utils/cryptography/SignatureChecker.sol";
import {IERC6551Account, IERC6551Executable} from "./erc6551/IERC6551.sol";

/// @title PetAccount – Token Bound Account (ERC-6551) eines Pets
/// @notice Jedes Pet-NFT "besitzt" diese Wallet. Wer das NFT besitzt, kontrolliert die Wallet.
///         Wird das Pet verkauft, wechselt das gesamte Inventar (Cosmetics, Trophaeen, ETH) automatisch mit.
/// @dev Wird nie direkt benutzt, sondern nur als Implementation hinter den ERC-1167 Proxies der Registry.
contract PetAccount is IERC165, IERC1271, IERC6551Account, IERC6551Executable, ERC721Holder, ERC1155Holder {
    /// @notice ERC-6551 state: wird bei JEDEM Abfluss von Assets erhoeht.
    ///         Der Marktplatz nutzt ihn als Schutz gegen "Inventar leeren kurz vor dem Verkauf".
    uint256 public state;

    error NotAuthorized();
    error OnlyCallOperation();
    error ApprovalsDisabled();

    event Swept(address indexed to, uint256 itemTypes, uint256 ethAmount);

    receive() external payable {}

    // ------------------------------------------------------------------ ERC-6551

    /// @notice NFT-Bindung aus dem Proxy-Footer lesen (Offset 0x4d = 45 Byte Proxy + 32 Byte salt).
    function token() public view returns (uint256 chainId, address tokenContract, uint256 tokenId) {
        bytes memory footer = new bytes(0x60);
        assembly {
            extcodecopy(address(), add(footer, 0x20), 0x4d, 0x60)
        }
        return abi.decode(footer, (uint256, address, uint256));
    }

    /// @notice Aktueller Owner = Owner des gebundenen NFTs (address(0) falls verbrannt / andere Chain).
    function owner() public view returns (address) {
        (uint256 chainId, address tokenContract, uint256 tokenId) = token();
        if (chainId != block.chainid) return address(0);
        try IERC721(tokenContract).ownerOf(tokenId) returns (address o) {
            return o;
        } catch {
            return address(0);
        }
    }

    function isValidSigner(address signer, bytes calldata) external view returns (bytes4) {
        return _isValidSigner(signer) ? IERC6551Account.isValidSigner.selector : bytes4(0);
    }

    function isValidSignature(bytes32 hash, bytes memory signature) external view returns (bytes4) {
        return SignatureChecker.isValidSignatureNow(owner(), hash, signature)
            ? IERC1271.isValidSignature.selector
            : bytes4(0);
    }

    /// @notice Beliebigen Call aus der Pet-Wallet ausfuehren (nur NFT-Owner).
    /// @dev approve/setApprovalForAll sind gesperrt: sonst koennte ein Operator spaeter Assets
    ///      abziehen, OHNE dass `state` steigt -> Marktplatz-Schutz waere aushebelbar.
    function execute(address to, uint256 value, bytes calldata data, uint8 operation)
        external
        payable
        returns (bytes memory result)
    {
        if (!_isValidSigner(msg.sender)) revert NotAuthorized();
        if (operation != 0) revert OnlyCallOperation();
        if (data.length >= 4) {
            bytes4 sel = bytes4(data[:4]);
            if (sel == IERC721.approve.selector || sel == IERC721.setApprovalForAll.selector) {
                revert ApprovalsDisabled();
            }
        }

        ++state;

        bool success;
        (success, result) = to.call{value: value}(data);
        if (!success) {
            assembly {
                revert(add(result, 32), mload(result))
            }
        }
    }

    // ------------------------------------------------------------------ Fusion

    /// @notice Inventar-Migration bei Fusion: alle Cosmetics (IDs 1..maxItemId) + ETH an `to`.
    /// @dev Nur der gebundene Token-Contract (PetNFT) darf das, und nur waehrend fuse().
    ///      Bewusst eng gefasst statt "PetNFT darf beliebig execute()" -> minimale Rechte.
    function sweepTo(address to, address cosmetics, uint256 maxItemId) external {
        (, address tokenContract,) = token();
        if (msg.sender != tokenContract) revert NotAuthorized();

        ++state;

        address[] memory accounts = new address[](maxItemId);
        uint256[] memory ids = new uint256[](maxItemId);
        for (uint256 i = 0; i < maxItemId; ++i) {
            accounts[i] = address(this);
            ids[i] = i + 1;
        }
        uint256[] memory balances = IERC1155(cosmetics).balanceOfBatch(accounts, ids);

        // nur IDs mit Bestand uebertragen
        uint256 n;
        for (uint256 i = 0; i < maxItemId; ++i) {
            if (balances[i] > 0) {
                ids[n] = ids[i];
                balances[n] = balances[i];
                ++n;
            }
        }
        assembly {
            mstore(ids, n)
            mstore(balances, n)
        }
        if (n > 0) IERC1155(cosmetics).safeBatchTransferFrom(address(this), to, ids, balances, "");

        uint256 eth = address(this).balance;
        if (eth > 0) {
            (bool ok,) = to.call{value: eth}("");
            require(ok, "ETH sweep failed");
        }
        emit Swept(to, n, eth);
    }

    // ------------------------------------------------------------------ intern

    function _isValidSigner(address signer) internal view returns (bool) {
        return signer != address(0) && signer == owner();
    }

    function supportsInterface(bytes4 interfaceId) public view override(IERC165, ERC1155Holder) returns (bool) {
        return interfaceId == type(IERC6551Account).interfaceId
            || interfaceId == type(IERC6551Executable).interfaceId || super.supportsInterface(interfaceId);
    }
}
