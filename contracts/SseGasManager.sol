// SPDX-License-Identifier: MIT
pragma solidity ^0.8.17;

import { AccessControl } from "@openzeppelin/contracts/access/AccessControl.sol";

contract SseGasManager is AccessControl {
    uint256 public gasFee;// per hashe fee
    event RequestedMatch(bytes32[] hashes);
    event GasFeeChange(uint256 fee);

    bytes32 public constant ADMIN_ROLE = keccak256("ADMIN_ROLE");

    constructor(uint256 fee) {
        _grantRole(ADMIN_ROLE, tx.origin);
        setGasPrice(fee);
    }

    function balance() public view returns (uint256) {
        return address(this).balance;
    }

    function requestMatchOrder(bytes32[] calldata hashes) public payable {
        uint256 needFees = gasFee * hashes.length;
        require(msg.value >= needFees, "Error for value!");
        if (msg.value > needFees) {
            payable(msg.sender).transfer(msg.value - needFees);
        }
        emit RequestedMatch(hashes);
    }

    function withdrawGas(address payable recipient, uint256 amount) public virtual onlyRole(ADMIN_ROLE) {
        require(address(this).balance >= amount, "");
        (bool success, ) = recipient.call{ value: amount }("");
        require(success, "withdrawGas: unable to send value, recipient may have reverted");
    }

    function setGasPrice(uint256 fee) public virtual onlyRole(ADMIN_ROLE) {
        require(fee > 0, "Error of fee");
        if (fee != gasFee) {
            gasFee = fee;
            emit GasFeeChange(fee);
        }
    }
}
