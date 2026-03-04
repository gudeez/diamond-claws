// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Script, console} from "forge-std/Script.sol";
import {IPoolManager} from "@uniswap/v4-core/src/interfaces/IPoolManager.sol";
import {Hooks} from "@uniswap/v4-core/src/libraries/Hooks.sol";
import {DCLAWSwap} from "../contracts/DCLAWSwap.sol";

contract MineSalt is Script {
    uint160 constant HOOK_FLAGS = uint160(Hooks.BEFORE_SWAP_FLAG | Hooks.BEFORE_SWAP_RETURNS_DELTA_FLAG);

    function run() external {
        address deployer = vm.addr(vm.envOr("PRIVATE_KEY", uint256(0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80)));
        address poolManager = vm.envOr("POOL_MANAGER", address(0));
        console.log("Deployer:", deployer);
        console.log("PoolManager:", poolManager);

        bytes memory hookCreationCode = abi.encodePacked(
            type(DCLAWSwap).creationCode,
            abi.encode(IPoolManager(poolManager), deployer)
        );
        bytes32 initCodeHash = keccak256(hookCreationCode);
        console.log("InitCodeHash:");
        console.logBytes32(initCodeHash);

        for (uint256 i = 0; i < 200000; i++) {
            bytes32 salt = bytes32(i);
            address hookAddress = vm.computeCreate2Address(salt, initCodeHash);
            if (_hasCorrectFlags(hookAddress)) {
                console.log("Found salt:", i);
                console.log("Salt hex:");
                console.logBytes32(salt);
                console.log("Hook address:", hookAddress);
                return;
            }
        }
        console.log("No salt found in 200000 iterations");
    }

    function _hasCorrectFlags(address addr) internal pure returns (bool) {
        uint160 ALL_FLAG_MASK = uint160(0x3FFF);
        return uint160(addr) & HOOK_FLAGS == HOOK_FLAGS
            && uint160(addr) & ~HOOK_FLAGS & ALL_FLAG_MASK == 0;
    }
}
