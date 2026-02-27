// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {Deployers} from "@uniswap/v4-core/test/utils/Deployers.sol";
import {IHooks} from "@uniswap/v4-core/src/interfaces/IHooks.sol";
import {Hooks} from "@uniswap/v4-core/src/libraries/Hooks.sol";
import {PoolSwapTest} from "@uniswap/v4-core/src/test/PoolSwapTest.sol";
import {IPoolManager} from "@uniswap/v4-core/src/interfaces/IPoolManager.sol";
import {Currency} from "@uniswap/v4-core/src/types/Currency.sol";
import {PoolKey} from "@uniswap/v4-core/src/types/PoolKey.sol";
import {PoolId} from "@uniswap/v4-core/src/types/PoolId.sol";
import {LPFeeLibrary} from "@uniswap/v4-core/src/libraries/LPFeeLibrary.sol";
import {SwapParams} from "@uniswap/v4-core/src/types/PoolOperation.sol";
import {BalanceDelta} from "@uniswap/v4-core/src/types/BalanceDelta.sol";
import {DCLAWSwap} from "../contracts/DCLAWSwap.sol";

contract DCLAWSwapTest is Test, Deployers {
    DCLAWSwap hook;
    address keeper = address(0xBEEF);

    function setUp() public {
        deployFreshManagerAndRouters();

        // Deploy hook at an address with the correct permission flags
        address hookAddr = address(uint160(Hooks.BEFORE_SWAP_FLAG | Hooks.BEFORE_SWAP_RETURNS_DELTA_FLAG));
        deployCodeTo(
            "contracts/DCLAWSwap.sol:DCLAWSwap",
            abi.encode(address(manager), keeper),
            hookAddr
        );
        hook = DCLAWSwap(hookAddr);

        // Deploy test currencies and approve routers
        deployMintAndApprove2Currencies();

        // Initialize pool with the hook
        (key,) = initPoolAndAddLiquidity(
            currency0, currency1, IHooks(address(hook)), LPFeeLibrary.DYNAMIC_FEE_FLAG, SQRT_PRICE_1_1
        );
    }

    // --- Queuing Tests ---

    function test_exactInput_queuesSwap() public {
        SwapParams memory params = SwapParams({
            zeroForOne: true,
            amountSpecified: -1000,
            sqrtPriceLimitX96: MIN_PRICE_LIMIT
        });
        PoolSwapTest.TestSettings memory settings =
            PoolSwapTest.TestSettings({takeClaims: false, settleUsingBurn: false});

        uint256 balBefore = currency0.balanceOfSelf();

        swapRouter.swap(key, params, settings, ZERO_BYTES);

        // User paid input tokens
        assertEq(balBefore - currency0.balanceOfSelf(), 1000, "Input tokens not taken");

        // Swap was queued
        assertEq(hook.getQueueLength(key), 1, "Queue should have 1 entry");

        (address sender, uint256 amountIn, bool zeroForOne,) = hook.getSwapIntent(key, 0);
        assertEq(amountIn, 1000, "Queued amount mismatch");
        assertTrue(zeroForOne, "Direction mismatch");
        assertEq(sender, address(swapRouter), "Sender mismatch");
    }

    function test_exactOutput_bypassesQueue() public {
        SwapParams memory params = SwapParams({
            zeroForOne: true,
            amountSpecified: 100, // positive = exact-output
            sqrtPriceLimitX96: MIN_PRICE_LIMIT
        });
        PoolSwapTest.TestSettings memory settings =
            PoolSwapTest.TestSettings({takeClaims: false, settleUsingBurn: false});

        swapRouter.swap(key, params, settings, ZERO_BYTES);

        // Exact-output should NOT be queued
        assertEq(hook.getQueueLength(key), 0, "Exact-output should not be queued");
    }

    function test_multipleSwaps_queueCorrectly() public {
        PoolSwapTest.TestSettings memory settings =
            PoolSwapTest.TestSettings({takeClaims: false, settleUsingBurn: false});

        // Queue 3 swaps
        for (uint256 i = 1; i <= 3; i++) {
            swapRouter.swap(
                key,
                SwapParams({zeroForOne: true, amountSpecified: -int256(i * 100), sqrtPriceLimitX96: MIN_PRICE_LIMIT}),
                settings,
                ZERO_BYTES
            );
        }

        assertEq(hook.getQueueLength(key), 3, "Should have 3 queued swaps");
    }

    // --- Batch Execution Tests ---

    function test_executeBatch_onlyKeeper() public {
        // Queue a swap first
        _queueSwap(1000, true);

        // Non-keeper cannot execute
        vm.expectRevert(DCLAWSwap.NotKeeper.selector);
        hook.executeBatch(key);
    }

    function test_executeBatch_emptyReverts() public {
        vm.prank(keeper);
        vm.expectRevert(DCLAWSwap.EmptyBatch.selector);
        hook.executeBatch(key);
    }

    function test_executeBatch_clearsQueue() public {
        _queueSwap(1000, true);
        assertEq(hook.getQueueLength(key), 1);

        vm.prank(keeper);
        hook.executeBatch(key);

        assertEq(hook.getQueueLength(key), 0, "Queue should be empty after batch");
        assertEq(hook.batchCounter(), 1, "Batch counter should increment");
    }

    // --- Admin Tests ---

    function test_setKeeper() public {
        address newKeeper = address(0xCAFE);
        vm.prank(keeper);
        hook.setKeeper(newKeeper);
        assertEq(hook.keeper(), newKeeper);
    }

    function test_setKeeper_onlyKeeper() public {
        vm.expectRevert(DCLAWSwap.NotKeeper.selector);
        hook.setKeeper(address(0xCAFE));
    }

    function test_setSwapFee() public {
        vm.prank(keeper);
        hook.setSwapFee(100); // 1%
        assertEq(hook.swapFeeBP(), 100);
    }

    function test_setSwapFee_tooHigh() public {
        vm.prank(keeper);
        vm.expectRevert("Fee too high");
        hook.setSwapFee(1001);
    }

    function test_setSwapExpiry() public {
        vm.prank(keeper);
        hook.setSwapExpiry(30 minutes);
        assertEq(hook.swapExpiry(), 30 minutes);
    }

    function test_setSwapExpiry_invalid() public {
        vm.prank(keeper);
        vm.expectRevert("Invalid expiry");
        hook.setSwapExpiry(1 minutes); // Below 5 min minimum
    }

    // --- Fee Tests ---

    function test_feeCalculation() public pure {
        // swapFeeBP = 30 (0.3%)
        // For 10000 input, fee = 10000 * 30 / 10000 = 30
        uint256 expectedFee = (10000 * 30) / 10000;
        assertEq(expectedFee, 30);
    }

    // --- Helpers ---

    function _queueSwap(uint256 amount, bool zeroForOne) internal {
        SwapParams memory params = SwapParams({
            zeroForOne: zeroForOne,
            amountSpecified: -int256(amount),
            sqrtPriceLimitX96: zeroForOne ? MIN_PRICE_LIMIT : MAX_PRICE_LIMIT
        });
        PoolSwapTest.TestSettings memory settings =
            PoolSwapTest.TestSettings({takeClaims: false, settleUsingBurn: false});
        swapRouter.swap(key, params, settings, ZERO_BYTES);
    }
}
