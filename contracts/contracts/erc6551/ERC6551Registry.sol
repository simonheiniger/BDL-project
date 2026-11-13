// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {Create2} from "@openzeppelin/contracts/utils/Create2.sol";
import {IERC6551Registry} from "./IERC6551.sol";

/// @title ERC-6551 Registry (lesbare Solidity-Variante der Referenz-Implementierung)
/// @notice Erzeugt pro NFT eine deterministische Account-Adresse via CREATE2.
///         Das Kurs-Testnetz (chainId 24888) hat keine kanonische Registry, darum deployen wir eine eigene.
/// @dev Deployter Bytecode = ERC-1167 Minimal-Proxy (45 Bytes) + Footer abi.encode(salt, chainId, tokenContract, tokenId).
///      Der Account liest seine NFT-Bindung aus diesem Footer (siehe PetAccount.token()).
contract ERC6551Registry is IERC6551Registry {
    function createAccount(
        address implementation,
        bytes32 salt,
        uint256 chainId,
        address tokenContract,
        uint256 tokenId
    ) external returns (address account_) {
        bytes memory code = _creationCode(implementation, salt, chainId, tokenContract, tokenId);
        account_ = Create2.computeAddress(salt, keccak256(code));

        // idempotent: existiert der Account schon, einfach Adresse zurueckgeben
        if (account_.code.length != 0) return account_;

        emit ERC6551AccountCreated(account_, implementation, salt, chainId, tokenContract, tokenId);

        address deployed;
        assembly {
            deployed := create2(0, add(code, 0x20), mload(code), salt)
        }
        if (deployed == address(0)) revert AccountCreationFailed();
    }

    function account(
        address implementation,
        bytes32 salt,
        uint256 chainId,
        address tokenContract,
        uint256 tokenId
    ) external view returns (address) {
        bytes memory code = _creationCode(implementation, salt, chainId, tokenContract, tokenId);
        return Create2.computeAddress(salt, keccak256(code));
    }

    function _creationCode(
        address implementation,
        bytes32 salt,
        uint256 chainId,
        address tokenContract,
        uint256 tokenId
    ) internal pure returns (bytes memory) {
        return abi.encodePacked(
            hex"3d60ad80600a3d3981f3363d3d373d3d3d363d73", // init code + ERC-1167 header
            implementation,
            hex"5af43d82803e903d91602b57fd5bf3", // ERC-1167 footer
            abi.encode(salt, chainId, tokenContract, tokenId) // 128 Bytes NFT-Bindung
        );
    }
}
