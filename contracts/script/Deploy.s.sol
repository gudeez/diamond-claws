// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

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
import {DCLAWLiquidityRouter} from "../contracts/DCLAWLiquidityRouter.sol";
import {AgentRegistry} from "../contracts/AgentRegistry.sol";

/**
 * @title Deploy
 * @dev Foundry deployment script for the Diamond Claws ecosystem.
 *
 *      Usage (local Anvil):
 *        anvil
 *        forge script script/Deploy.s.sol --rpc-url http://127.0.0.1:8545 --broadcast
 *
 *      Usage (Base Sepolia with existing PoolManager):
 *        PRIVATE_KEY=0x... POOL_MANAGER=0x05E73354cFDd6745C338b50BcFDfA3Aa6fA03408 \
 *          forge script script/Deploy.s.sol --rpc-url https://base-sepolia-rpc.publicnode.com --broadcast --slow
 *
 *      The hook address must encode permission flags in its lower address bits.
 *      CREATE2 salt is mined before broadcast to avoid slow fork simulation.
 */
contract Deploy is Script {
    // Hook flags required: BEFORE_SWAP (1<<7) | BEFORE_SWAP_RETURNS_DELTA (1<<3) = 0x88
    uint160 constant HOOK_FLAGS = uint160(Hooks.BEFORE_SWAP_FLAG | Hooks.BEFORE_SWAP_RETURNS_DELTA_FLAG);

    function run() external {
        uint256 deployerKey = vm.envOr("PRIVATE_KEY", uint256(0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80)); // Anvil account #0
        address deployer = vm.addr(deployerKey);

        // Use existing PoolManager if POOL_MANAGER env is set (for testnet/mainnet), otherwise deploy new
        address existingPM = vm.envOr("POOL_MANAGER", address(0));

        console.log("Deployer:", deployer);

        // --- Pre-broadcast: mine CREATE2 salt locally (no RPC needed) ---
        // When using an existing PoolManager, we know the address ahead of time.
        // For local Anvil, we predict the PoolManager address from deployer nonce.
        address pmAddressForSalt;
        if (existingPM != address(0)) {
            pmAddressForSalt = existingPM;
        } else {
            // On Anvil, PoolManager is the first deployment (nonce 0 by default)
            pmAddressForSalt = vm.computeCreateAddress(deployer, vm.getNonce(deployer));
        }

        (bytes32 salt, address hookAddress) = _mineSalt(pmAddressForSalt, deployer);
        console.log("Pre-mined salt:", vm.toString(salt));
        console.log("Expected hook:", hookAddress);

        // --- Broadcast: deploy contracts ---
        vm.startBroadcast(deployerKey);

        // 1. Deploy or use existing PoolManager
        PoolManager poolManager;
        if (existingPM != address(0)) {
            poolManager = PoolManager(payable(existingPM));
            console.log("Using existing PoolManager:", existingPM);
        } else {
            poolManager = new PoolManager(deployer);
        }
        console.log("PoolManager:", address(poolManager));

        // 2. Deploy DiamondClaws token
        DiamondClaws dclaw = new DiamondClaws(deployer, deployer);
        console.log("DiamondClaws:", address(dclaw));

        // 3. Deploy Staking contract
        DiamondClawsStaking staking = new DiamondClawsStaking(address(dclaw), deployer, deployer);
        console.log("DiamondClawsStaking:", address(staking));

        // 4. Link staking contract to token
        dclaw.setStakingContract(address(staking));

        // 5. Deploy DCLAWSwap hook via CREATE2 with pre-mined salt
        DCLAWSwap hook = new DCLAWSwap{salt: salt}(IPoolManager(address(poolManager)), deployer);
        require(address(hook) == hookAddress, "Hook address mismatch");
        console.log("DCLAWSwap hook:", address(hook));

        // 6. Deploy liquidity router
        DCLAWLiquidityRouter liquidityRouter = new DCLAWLiquidityRouter(IPoolManager(address(poolManager)));
        console.log("LiquidityRouter:", address(liquidityRouter));

        // 7. Deploy AgentRegistry
        AgentRegistry agentRegistry = new AgentRegistry(deployer);
        agentRegistry.setAgentWallet(deployer);
        console.log("AgentRegistry:", address(agentRegistry));

        // 8. Exclude hook and liquidity router from token taxes
        dclaw.setTaxExcluded(address(hook), true);
        dclaw.setTaxExcluded(address(liquidityRouter), true);

        // 9. Initialize a DCLAW/ETH pool with the hook
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
        console.log("LiquidityRouter:    ", address(liquidityRouter));
        console.log("AgentRegistry:      ", address(agentRegistry));
        console.log("========================================");
    }

    function _mineSalt(address pmAddress, address deployer) internal pure returns (bytes32, address) {
        bytes memory hookCreationCode = abi.encodePacked(
            type(DCLAWSwap).creationCode,
            abi.encode(IPoolManager(pmAddress), deployer)
        );
        bytes32 initCodeHash = keccak256(hookCreationCode);

        for (uint256 i = 0; i < 200000; i++) {
            bytes32 salt = bytes32(i);
            // CREATE2 address = keccak256(0xff ++ deployer ++ salt ++ initCodeHash)
            // vm.computeCreate2Address uses the default CREATE2 deployer
            address hookAddr = address(uint160(uint256(keccak256(abi.encodePacked(
                bytes1(0xff),
                address(0x4e59b44847b379578588920cA78FbF26c0B4956C), // deterministic deployer
                salt,
                initCodeHash
            )))));
            if (_hasCorrectFlags(hookAddr)) {
                return (salt, hookAddr);
            }
        }
        revert("Could not find valid hook salt in 200000 iterations");
    }

    function _hasCorrectFlags(address addr) internal pure returns (bool) {
        // All hook permission flags span bits 0-13 (0x3FFF)
        uint160 ALL_FLAG_MASK = uint160(0x3FFF);
        return uint160(addr) & HOOK_FLAGS == HOOK_FLAGS
            && uint160(addr) & ~HOOK_FLAGS & ALL_FLAG_MASK == 0; // Only our flags, no extras
    }
}
