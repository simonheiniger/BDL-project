// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {PetNFT} from "./PetNFT.sol";
import {PetAccount} from "./PetAccount.sol";

/// @title Marketplace – Festpreis-Handel von Pets (inkl. ganzem TBA-Inventar)
/// @notice Problem bei ERC-6551: Verkaeufer koennte das Inventar leeren, NACHDEM der Kaeufer es gesehen hat
///         (Front-Running). Schutz: Listing merkt sich PetAccount.state(); der Kaeufer uebergibt den State,
///         den er gesehen hat. Hat sich das Inventar seither veraendert (state++), revertiert der Kauf.
contract Marketplace is Ownable, ReentrancyGuard {
    struct Listing {
        address seller;
        uint96 price;
        uint256 accountState;
    }

    uint256 public constant FEE_BP = 250; // 2.5 %

    PetNFT public immutable pets;
    mapping(uint256 => Listing) public listings;
    mapping(address => uint256) public pending;

    event Listed(uint256 indexed petId, address indexed seller, uint256 price, uint256 accountState);
    event Cancelled(uint256 indexed petId);
    event Sold(uint256 indexed petId, address indexed seller, address indexed buyer, uint256 price);

    error NotOwner();
    error NotApproved();
    error NotListed();
    error WrongPayment();
    error InventoryChanged();

    constructor(PetNFT pets_) Ownable(msg.sender) {
        pets = pets_;
    }

    function list(uint256 petId, uint96 price) external {
        if (pets.ownerOf(petId) != msg.sender) revert NotOwner();
        if (pets.getApproved(petId) != address(this) && !pets.isApprovedForAll(msg.sender, address(this))) {
            revert NotApproved();
        }
        uint256 st = PetAccount(payable(pets.accountOf(petId))).state();
        listings[petId] = Listing(msg.sender, price, st);
        emit Listed(petId, msg.sender, price, st);
    }

    function cancel(uint256 petId) external {
        if (listings[petId].seller != msg.sender) revert NotOwner();
        delete listings[petId];
        emit Cancelled(petId);
    }

    /// @param expectedState der PetAccount.state(), den der Kaeufer im UI gesehen hat
    function buy(uint256 petId, uint256 expectedState) external payable nonReentrant {
        Listing memory l = listings[petId];
        if (l.seller == address(0)) revert NotListed();
        if (msg.value != l.price) revert WrongPayment();
        if (pets.ownerOf(petId) != l.seller) revert NotListed(); // inzwischen anderweitig transferiert/fusioniert

        uint256 st = PetAccount(payable(pets.accountOf(petId))).state();
        if (st != l.accountState || st != expectedState) revert InventoryChanged();

        delete listings[petId];
        uint256 fee = (msg.value * FEE_BP) / 10_000;
        pending[owner()] += fee;
        pending[l.seller] += msg.value - fee;

        pets.safeTransferFrom(l.seller, msg.sender, petId);
        emit Sold(petId, l.seller, msg.sender, msg.value);
    }

    function withdraw() external nonReentrant {
        uint256 amt = pending[msg.sender];
        pending[msg.sender] = 0;
        (bool ok,) = msg.sender.call{value: amt}("");
        require(ok, "withdraw failed");
    }
}
