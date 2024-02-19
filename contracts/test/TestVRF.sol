// SPDX-License-Identifier: MIT
pragma solidity ^0.8.13;

interface IVRFInterface {
    function requestRandomWords(uint32) external returns (uint256 requestId);
}

contract TestVRF is IVRFInterface {
    function requestRandomWords(uint32 numWords) external pure override returns (uint256) {
        return uint256(numWords);
    }
}
