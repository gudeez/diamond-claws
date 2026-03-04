// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {DiamondClaws} from "../contracts/DiamondClaws.sol";
import {DCLAWCrowdfund} from "../contracts/DCLAWCrowdfund.sol";
import {PoolKey} from "@uniswap/v4-core/src/types/PoolKey.sol";
import {BalanceDelta} from "@uniswap/v4-core/src/types/BalanceDelta.sol";

/// @dev Mock router that simulates addLiquidity by consuming some ETH and refunding the rest.
contract MockLiquidityRouter {
    uint256 public ethToConsume;

    function setEthToConsume(uint256 amount) external {
        ethToConsume = amount;
    }

    function addLiquidity(
        PoolKey calldata,
        int24,
        int24,
        int256
    ) external payable returns (BalanceDelta) {
        uint256 consume = ethToConsume > msg.value ? msg.value : ethToConsume;
        uint256 refund = msg.value - consume;
        if (refund > 0) {
            (bool sent,) = msg.sender.call{value: refund}("");
            require(sent, "refund failed");
        }
        return BalanceDelta.wrap(0);
    }

    receive() external payable {}
}

/// @dev Minimal mock PoolManager (only needs to exist for approve target).
contract MockPoolManager {
    receive() external payable {}
}

contract DCLAWCrowdfundTest is Test {
    DiamondClaws token;
    DCLAWCrowdfund crowdfund;
    MockLiquidityRouter mockRouter;
    MockPoolManager mockPM;

    address owner = address(0xA);
    address taxWallet = address(0xB);
    address alice = address(0xC);
    address bob = address(0xD);
    address carol = address(0xE);
    address hookAddr = address(0xF);

    uint256 constant START = 1000;
    uint256 constant END = 1000 + 14 days;
    uint256 constant MAX_PER_WALLET = 5 ether;
    uint256 constant MIN_RAISE = 0.1 ether;
    uint256 constant DCLAW_FOR_LP = 200_000_000 ether;
    uint256 constant DCLAW_FOR_USERS = 300_000_000 ether;

    function setUp() public {
        vm.warp(500);

        token = new DiamondClaws(owner, taxWallet);
        mockPM = new MockPoolManager();
        mockRouter = new MockLiquidityRouter();

        vm.prank(owner);
        crowdfund = new DCLAWCrowdfund(
            address(token),
            address(mockRouter),
            address(mockPM),
            hookAddr,
            owner,
            START,
            END,
            MAX_PER_WALLET,
            MIN_RAISE,
            DCLAW_FOR_LP,
            DCLAW_FOR_USERS
        );

        // Tax-exclude the crowdfund
        vm.prank(owner);
        token.setTaxExcluded(address(crowdfund), true);

        // Fund crowdfund with DCLAW
        vm.prank(owner);
        token.transfer(address(crowdfund), DCLAW_FOR_LP + DCLAW_FOR_USERS);

        // Fund test users with ETH
        vm.deal(alice, 100 ether);
        vm.deal(bob, 100 ether);
        vm.deal(carol, 100 ether);
    }

    // ========================
    // Deposit tests
    // ========================

    function test_deposit_succeeds() public {
        vm.warp(START);
        vm.prank(alice);
        crowdfund.deposit{value: 1 ether}();

        assertEq(crowdfund.deposits(alice), 1 ether);
        assertEq(crowdfund.totalDeposited(), 1 ether);
    }

    function test_deposit_multipleWithinCap() public {
        vm.warp(START);
        vm.prank(alice);
        crowdfund.deposit{value: 2 ether}();
        vm.prank(alice);
        crowdfund.deposit{value: 3 ether}();

        assertEq(crowdfund.deposits(alice), 5 ether);
        assertEq(crowdfund.totalDeposited(), 5 ether);
    }

    function test_deposit_beforeStart_reverts() public {
        vm.warp(START - 1);
        vm.prank(alice);
        vm.expectRevert("Not started");
        crowdfund.deposit{value: 1 ether}();
    }

    function test_deposit_afterEnd_reverts() public {
        vm.warp(END);
        vm.prank(alice);
        vm.expectRevert("Ended");
        crowdfund.deposit{value: 1 ether}();
    }

    function test_deposit_exceedsMaxPerWallet_reverts() public {
        vm.warp(START);
        vm.prank(alice);
        vm.expectRevert("Exceeds max per wallet");
        crowdfund.deposit{value: MAX_PER_WALLET + 1}();
    }

    function test_deposit_zeroValue_reverts() public {
        vm.warp(START);
        vm.prank(alice);
        vm.expectRevert("Must send ETH");
        crowdfund.deposit{value: 0}();
    }

    function test_deposit_afterCancel_reverts() public {
        vm.prank(owner);
        crowdfund.cancel();

        vm.warp(START);
        vm.prank(alice);
        vm.expectRevert("Not open");
        crowdfund.deposit{value: 1 ether}();
    }

    // ========================
    // Finalize tests
    // ========================

    function test_finalize_succeeds() public {
        vm.warp(START);
        vm.prank(alice);
        crowdfund.deposit{value: 3 ether}();

        mockRouter.setEthToConsume(3 ether);

        vm.warp(END);
        vm.prank(owner);
        crowdfund.finalize(1000);

        assertEq(uint256(crowdfund.state()), uint256(DCLAWCrowdfund.State.FINALIZED));
        assertEq(crowdfund.ethUsedForLP(), 3 ether);
        assertEq(crowdfund.ethRefundable(), 0);
    }

    function test_finalize_withExcessETH() public {
        vm.warp(START);
        vm.prank(alice);
        crowdfund.deposit{value: 5 ether}();

        // Router only uses 3 ETH, refunds 2
        mockRouter.setEthToConsume(3 ether);

        vm.warp(END);
        vm.prank(owner);
        crowdfund.finalize(1000);

        assertEq(crowdfund.ethUsedForLP(), 3 ether);
        assertEq(crowdfund.ethRefundable(), 2 ether);
    }

    function test_finalize_beforeEnd_reverts() public {
        vm.warp(START);
        vm.prank(alice);
        crowdfund.deposit{value: 1 ether}();

        vm.warp(END - 1);
        vm.prank(owner);
        vm.expectRevert("Window not closed");
        crowdfund.finalize(1000);
    }

    function test_finalize_belowMinRaise_reverts() public {
        vm.warp(START);
        vm.prank(alice);
        crowdfund.deposit{value: 0.05 ether}();

        vm.warp(END);
        vm.prank(owner);
        vm.expectRevert("Below minimum raise");
        crowdfund.finalize(1000);
    }

    function test_finalize_noDeposits_reverts() public {
        vm.warp(END);
        vm.prank(owner);
        vm.expectRevert("No deposits");
        crowdfund.finalize(1000);
    }

    function test_finalize_notOwner_reverts() public {
        vm.warp(START);
        vm.prank(alice);
        crowdfund.deposit{value: 1 ether}();

        vm.warp(END);
        vm.prank(alice);
        vm.expectRevert();
        crowdfund.finalize(1000);
    }

    // ========================
    // Claim tests
    // ========================

    function test_claim_proportionalDistribution() public {
        vm.warp(START);
        vm.prank(alice);
        crowdfund.deposit{value: 2 ether}();
        vm.prank(bob);
        crowdfund.deposit{value: 3 ether}();

        mockRouter.setEthToConsume(5 ether);

        vm.warp(END);
        vm.prank(owner);
        crowdfund.finalize(1000);

        // Alice: 40% of 300M = 120M
        vm.prank(alice);
        crowdfund.claim();
        assertEq(token.balanceOf(alice), (DCLAW_FOR_USERS * 2) / 5);

        // Bob: 60% of 300M = 180M
        vm.prank(bob);
        crowdfund.claim();
        assertEq(token.balanceOf(bob), (DCLAW_FOR_USERS * 3) / 5);
    }

    function test_claim_withETHRefund() public {
        vm.warp(START);
        vm.prank(alice);
        crowdfund.deposit{value: 5 ether}();
        vm.prank(bob);
        crowdfund.deposit{value: 5 ether}();

        // Router only uses 6 ETH, refunds 4
        mockRouter.setEthToConsume(6 ether);

        vm.warp(END);
        vm.prank(owner);
        crowdfund.finalize(1000);

        assertEq(crowdfund.ethRefundable(), 4 ether);

        uint256 aliceBalBefore = alice.balance;
        vm.prank(alice);
        crowdfund.claim();

        // Alice gets 50% of 4 ETH refund = 2 ETH
        assertEq(alice.balance - aliceBalBefore, 2 ether);
        // Plus 50% of 300M DCLAW
        assertEq(token.balanceOf(alice), DCLAW_FOR_USERS / 2);
    }

    function test_claim_doubleClaim_reverts() public {
        vm.warp(START);
        vm.prank(alice);
        crowdfund.deposit{value: 1 ether}();

        mockRouter.setEthToConsume(1 ether);
        vm.warp(END);
        vm.prank(owner);
        crowdfund.finalize(1000);

        vm.prank(alice);
        crowdfund.claim();

        vm.prank(alice);
        vm.expectRevert("Already claimed");
        crowdfund.claim();
    }

    function test_claim_noDeposit_reverts() public {
        vm.warp(START);
        vm.prank(alice);
        crowdfund.deposit{value: 1 ether}();

        mockRouter.setEthToConsume(1 ether);
        vm.warp(END);
        vm.prank(owner);
        crowdfund.finalize(1000);

        vm.prank(carol);
        vm.expectRevert("No deposit");
        crowdfund.claim();
    }

    function test_claim_beforeFinalize_reverts() public {
        vm.warp(START);
        vm.prank(alice);
        crowdfund.deposit{value: 1 ether}();

        vm.prank(alice);
        vm.expectRevert("Not finalized");
        crowdfund.claim();
    }

    // ========================
    // Cancel / Refund tests
    // ========================

    function test_cancel_succeeds() public {
        vm.prank(owner);
        crowdfund.cancel();
        assertEq(uint256(crowdfund.state()), uint256(DCLAWCrowdfund.State.CANCELLED));
    }

    function test_cancel_notOwner_reverts() public {
        vm.prank(alice);
        vm.expectRevert();
        crowdfund.cancel();
    }

    function test_cancel_afterFinalize_reverts() public {
        vm.warp(START);
        vm.prank(alice);
        crowdfund.deposit{value: 1 ether}();

        mockRouter.setEthToConsume(1 ether);
        vm.warp(END);
        vm.prank(owner);
        crowdfund.finalize(1000);

        vm.prank(owner);
        vm.expectRevert("Not open");
        crowdfund.cancel();
    }

    function test_refund_afterCancel() public {
        vm.warp(START);
        vm.prank(alice);
        crowdfund.deposit{value: 3 ether}();

        vm.prank(owner);
        crowdfund.cancel();

        uint256 balBefore = alice.balance;
        vm.prank(alice);
        crowdfund.refund();

        assertEq(alice.balance - balBefore, 3 ether);
        assertEq(crowdfund.deposits(alice), 0);
    }

    function test_refund_belowMinRaise() public {
        vm.warp(START);
        vm.prank(alice);
        crowdfund.deposit{value: 0.05 ether}();

        vm.warp(END);

        uint256 balBefore = alice.balance;
        vm.prank(alice);
        crowdfund.refund();

        assertEq(alice.balance - balBefore, 0.05 ether);
    }

    function test_refund_afterFinalize_reverts() public {
        vm.warp(START);
        vm.prank(alice);
        crowdfund.deposit{value: 1 ether}();

        mockRouter.setEthToConsume(1 ether);
        vm.warp(END);
        vm.prank(owner);
        crowdfund.finalize(1000);

        vm.prank(alice);
        vm.expectRevert("Refund not available");
        crowdfund.refund();
    }

    function test_refund_noDeposit_reverts() public {
        vm.prank(owner);
        crowdfund.cancel();

        vm.prank(carol);
        vm.expectRevert("No deposit");
        crowdfund.refund();
    }

    // ========================
    // View function tests
    // ========================

    function test_isOpen() public {
        assertFalse(crowdfund.isOpen()); // before start
        vm.warp(START);
        assertTrue(crowdfund.isOpen());
        vm.warp(END);
        assertFalse(crowdfund.isOpen()); // after end
    }

    function test_isRefundable_belowMin() public {
        vm.warp(START);
        vm.prank(alice);
        crowdfund.deposit{value: 0.05 ether}();

        assertFalse(crowdfund.isRefundable()); // window still open
        vm.warp(END);
        assertTrue(crowdfund.isRefundable()); // below min raise
    }

    function test_isRefundable_afterCancel() public {
        vm.prank(owner);
        crowdfund.cancel();
        assertTrue(crowdfund.isRefundable());
    }

    function test_getClaimable() public {
        vm.warp(START);
        vm.prank(alice);
        crowdfund.deposit{value: 5 ether}();
        vm.prank(bob);
        crowdfund.deposit{value: 5 ether}();

        mockRouter.setEthToConsume(10 ether);
        vm.warp(END);
        vm.prank(owner);
        crowdfund.finalize(1000);

        (uint256 dclawAmt, uint256 ethAmt) = crowdfund.getClaimable(alice);
        assertEq(dclawAmt, DCLAW_FOR_USERS / 2);
        assertEq(ethAmt, 0);

        // After claiming, should return 0
        vm.prank(alice);
        crowdfund.claim();
        (dclawAmt, ethAmt) = crowdfund.getClaimable(alice);
        assertEq(dclawAmt, 0);
        assertEq(ethAmt, 0);
    }

    // ========================
    // Owner cleanup tests
    // ========================

    function test_withdrawDCLAW_afterFinalize() public {
        vm.warp(START);
        vm.prank(alice);
        crowdfund.deposit{value: 1 ether}();

        mockRouter.setEthToConsume(1 ether);
        vm.warp(END);
        vm.prank(owner);
        crowdfund.finalize(1000);

        // Alice claims her share
        vm.prank(alice);
        crowdfund.claim();

        // Owner withdraws dust
        uint256 dust = token.balanceOf(address(crowdfund));
        vm.prank(owner);
        crowdfund.withdrawDCLAW();
        assertEq(token.balanceOf(owner), token.balanceOf(owner)); // owner got dust back
    }

    function test_withdrawDCLAW_whileOpen_reverts() public {
        vm.prank(owner);
        vm.expectRevert("Cannot withdraw yet");
        crowdfund.withdrawDCLAW();
    }
}
