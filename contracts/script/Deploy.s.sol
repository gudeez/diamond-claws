// SPDX-License-Identifier: MIT
pragma solidity ^0.8.27;

import {Script, console} from "forge-std/Script.sol";
import {IPoolManager} from "@uniswap/v4-core/src/interfaces/IPoolManager.sol";
import {PoolManager} from "@uniswap/v4-core/src/PoolManager.sol";
import {PoolKey} from "@uniswap/v4-core/src/types/PoolKey.sol";
import {Currency} from "@uniswap/v4-core/src/types/Currency.sol";
import {IHooks} from "@uniswap/v4-core/src/interfaces/IHooks.sol";
import {Hooks} from "@uniswap/v4-core/src/libraries/Hooks.sol";
import {DiamondClaws} from "../contracts/DiamondClaws.sol";
import {DiamondClawsStaking} from "../contracts/DiamondClawsStaking.sol";
import {DCLAWSwap} from "../contracts/DCLAWSwap.sol";

/**
 * @title Deploy
 * @dev Foundry deployment script for the Diamond Claws ecosystem.
 *
 *      Usage (local Anvil):
 *        anvil
 *        forge script script/Deploy.s.sol --rpc-url http://127.0.0.1:8545 --broadcast
 *
 *      The hook address must encode permission flags in its lower address bits.
 *      We mine a CREATE2 salt to produce a valid hook address.
 */
contract Deploy is Script {
    // Hook flags required: BEFORE_SWAP (1<<7) | BEFORE_SWAP_RETURNS_DELTA (1<<3) = 0x88
    uint160 constant HOOK_FLAGS = uint160(Hooks.BEFORE_SWAP_FLAG | Hooks.BEFORE_SWAP_RETURNS_DELTA_FLAG);

    function run() external {
        uint256 deployerKey = vm.envOr("PRIVATE_KEY", uint256(0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80)); // Anvil account #0
        address deployer = vm.addr(deployerKey);

        console.log("Deployer:", deployer);

        vm.startBroadcast(deployerKey);

        // 1. Deploy PoolManager (for local dev; on mainnet/testnet use existing deployment)
        PoolManager poolManager = new PoolManager(deployer);
        console.log("PoolManager:", address(poolManager));

        // 2. Deploy DiamondClaws token
        DiamondClaws dclaw = new DiamondClaws(deployer, deployer);
        console.log("DiamondClaws:", address(dclaw));

        // 3. Deploy Staking contract
        DiamondClawsStaking staking = new DiamondClawsStaking(address(dclaw), deployer, deployer);
        console.log("DiamondClawsStaking:", address(staking));

        // 4. Link staking contract to token
        dclaw.setStakingContract(address(staking));

        // 5. Deploy DCLAWSwap hook via CREATE2 with a mined salt
        //    The hook address must have the correct permission flags in its lower bits.
        bytes memory hookCreationCode = abi.encodePacked(
            type(DCLAWSwap).creationCode,
            abi.encode(IPoolManager(address(poolManager)), deployer)
        );

        address hookAddress;
        bytes32 salt;
        for (uint256 i = 0; i < 10000; i++) {
            salt = bytes32(i);
            hookAddress = vm.computeCreate2Address(salt, keccak256(hookCreationCode));
            if (_hasCorrectFlags(hookAddress)) {
                break;
            }
        }
        require(_hasCorrectFlags(hookAddress), "Could not find valid hook salt");

        DCLAWSwap hook = new DCLAWSwap{salt: salt}(IPoolManager(address(poolManager)), deployer);
        require(address(hook) == hookAddress, "Hook address mismatch");
        console.log("DCLAWSwap hook:", address(hook));
        console.log("Salt:", vm.toString(salt));

        // 6. Exclude hook from token taxes
        dclaw.setTaxExcluded(address(hook), true);

        // 7. Initialize a DCLAW/ETH pool with the hook
        //    Currency0 must be < Currency1 by address sort order.
        //    Native ETH = address(0), DCLAW = address(dclaw)
        Currency currency0;
        Currency currency1;
        if (address(0) < address(dclaw)) {
            currency0 = Currency.wrap(address(0));
            currency1 = Currency.wrap(address(dclaw));
        } else {
            currency0 = Currency.wrap(address(dclaw));
            currency1 = Currency.wrap(address(0));
        }

        PoolKey memory poolKey = PoolKey({
            currency0: currency0,
            currency1: currency1,
            fee: 3000, // 0.3% LP fee
            tickSpacing: 60,
            hooks: IHooks(address(hook))
        });

        // Initialize at 1 ETH = 1,000,000 DCLAW (sqrt price for this ratio)
        // sqrtPriceX96 = sqrt(1e6) * 2^96 = 1000 * 2^96
        uint160 sqrtPriceX96 = 79228162514264337593543950336000; // ~1000 * 2^96
        poolManager.initialize(poolKey, sqrtPriceX96);
        console.log("Pool initialized");

        vm.stopBroadcast();

        // Print summary
        console.log("\n========== DEPLOYMENT SUMMARY ==========");
        console.log("PoolManager:        ", address(poolManager));
        console.log("DiamondClaws (DCLAW):", address(dclaw));
        console.log("DiamondClawsStaking:", address(staking));
        console.log("DCLAWSwap Hook:     ", address(hook));
        console.log("========================================");
    }

    function _hasCorrectFlags(address addr) internal pure returns (bool) {
        return uint160(addr) & HOOK_FLAGS == HOOK_FLAGS
            && uint160(addr) & ~HOOK_FLAGS & uint160(0xFF) == 0; // Only our flags, no extras
    }
}
