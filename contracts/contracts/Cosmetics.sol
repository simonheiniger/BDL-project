// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {ERC1155} from "@openzeppelin/contracts/token/ERC1155/ERC1155.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";

/// @title Cosmetics – rein kosmetische Items (ERC-1155) inkl. Shop
/// @notice Items haben KEINEN Einfluss auf Stats (GameMath liest sie nie) -> kein Pay-to-Win.
///         ERC-1155, weil viele identische Exemplare pro Item-Typ existieren (fungible pro ID, guenstig im Batch).
contract Cosmetics is ERC1155, Ownable {
    uint256 public constant MAX_ITEM_ID = 32; // muss zu PetNFT.MAX_ITEM_ID passen

    struct Item {
        string name;
        uint128 price;
        uint64 maxSupply;
        uint64 minted;
    }

    mapping(uint256 => Item) public items;
    uint256 public itemCount;

    event ItemAdded(uint256 indexed id, string name, uint256 price, uint256 maxSupply);
    event Bought(address indexed buyer, address indexed to, uint256 indexed id, uint256 amount);

    error UnknownItem();
    error SoldOut();
    error WrongPayment();
    error TooManyItems();

    constructor(string memory uri_) ERC1155(uri_) Ownable(msg.sender) {}

    function addItem(string calldata name, uint128 price, uint64 maxSupply) external onlyOwner returns (uint256 id) {
        id = ++itemCount;
        if (id > MAX_ITEM_ID) revert TooManyItems();
        items[id] = Item(name, price, maxSupply, 0);
        emit ItemAdded(id, name, price, maxSupply);
    }

    /// @notice Item kaufen und direkt in eine Wallet (typisch: das TBA eines Pets) minten.
    function buy(uint256 id, uint256 amount, address to) external payable {
        Item storage it = items[id];
        if (id == 0 || id > itemCount) revert UnknownItem();
        if (it.minted + amount > it.maxSupply) revert SoldOut();
        if (msg.value != uint256(it.price) * amount) revert WrongPayment();
        it.minted += uint64(amount);
        _mint(to, id, amount, "");
        emit Bought(msg.sender, to, id, amount);
    }

    function withdraw(address payable to) external onlyOwner {
        (bool ok,) = to.call{value: address(this).balance}("");
        require(ok, "withdraw failed");
    }
}
