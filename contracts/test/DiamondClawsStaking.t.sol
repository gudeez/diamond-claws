// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {DiamondClaws} from "../contracts/DiamondClaws.sol";
import {DiamondClawsStaking} from "../contracts/DiamondClawsStaking.sol";

contract DiamondClawsStakingTest is Test {
    DiamondClaws token;
    DiamondClawsStaking staking;
    address owner = address(0xA);
    address taxWallet = address(0xB);
    address alice = address(0xC);
    address operator = address(0xD);

    function setUp() public {
        token = new DiamondClaws(owner, taxWallet);
        staking = new DiamondClawsStaking(address(token), taxWallet, owner);

        vm.prank(owner);
        token.setStakingContract(address(staking));

        // Fund alice
        vm.prank(owner);
        token.transfer(alice, 10000 ether);
    }

    // --- Operator Delegation ---

    function test_setOperatorApproval() public {
        vm.prank(alice);
        staking.setOperatorApproval(operator, true);
        assertTrue(staking.operatorApprovals(alice, operator));
    }

    function test_setOperatorApproval_revoke() public {
        vm.prank(alice);
        staking.setOperatorApproval(operator, true);
        assertTrue(staking.operatorApprovals(alice, operator));

        vm.prank(alice);
        staking.setOperatorApproval(operator, false);
        assertFalse(staking.operatorApprovals(alice, operator));
    }

    // --- stakeFor ---

    function test_stakeFor_byOperator() public {
        vm.prank(alice);
        token.approve(address(staking), 1000 ether);
        vm.prank(alice);
        staking.setOperatorApproval(operator, true);

        vm.prank(operator);
        staking.stakeFor(alice, 1000 ether);

        assertEq(staking.getStakeCount(alice), 1);
        assertEq(staking.totalStaked(), 1000 ether);
    }

    function test_stakeFor_bySelf() public {
        vm.prank(alice);
        token.approve(address(staking), 1000 ether);

        vm.prank(alice);
        staking.stakeFor(alice, 1000 ether);

        assertEq(staking.getStakeCount(alice), 1);
    }

    function test_stakeFor_unauthorized_reverts() public {
        vm.prank(alice);
        token.approve(address(staking), 1000 ether);

        vm.prank(operator);
        vm.expectRevert("Not user or approved operator");
        staking.stakeFor(alice, 1000 ether);
    }

    function test_stakeFor_zeroBeneficiary_reverts() public {
        vm.prank(alice);
        staking.setOperatorApproval(operator, true);

        // address(0) fails the onlyUserOrOperator check first since operator isn't approved for address(0)
        vm.prank(operator);
        vm.expectRevert("Not user or approved operator");
        staking.stakeFor(address(0), 1000 ether);
    }

    // --- unstakeFor ---

    function test_unstakeFor_byOperator() public {
        // Setup: alice stakes
        vm.startPrank(alice);
        token.approve(address(staking), 1000 ether);
        staking.stake(1000 ether);
        staking.setOperatorApproval(operator, true);
        vm.stopPrank();

        // Warp past early unstake period
        vm.warp(block.timestamp + 8 days);

        uint256 aliceBalBefore = token.balanceOf(alice);

        // Operator unstakes — tokens go to alice, not operator
        vm.prank(operator);
        staking.unstakeFor(alice, 0);

        assertTrue(token.balanceOf(alice) > aliceBalBefore);
        assertEq(token.balanceOf(operator), 0); // operator receives nothing
        assertEq(staking.totalStaked(), 0);
    }

    function test_unstakeFor_unauthorized_reverts() public {
        vm.startPrank(alice);
        token.approve(address(staking), 1000 ether);
        staking.stake(1000 ether);
        vm.stopPrank();

        vm.prank(operator);
        vm.expectRevert("Not user or approved operator");
        staking.unstakeFor(alice, 0);
    }

    // --- claimRewardsFor ---

    function test_claimRewardsFor_byOperator() public {
        vm.startPrank(alice);
        token.approve(address(staking), 1000 ether);
        staking.stake(1000 ether);
        staking.setOperatorApproval(operator, true);
        vm.stopPrank();

        vm.warp(block.timestamp + 30 days);

        uint256 aliceBalBefore = token.balanceOf(alice);

        vm.prank(operator);
        staking.claimRewardsFor(alice, 0);

        assertTrue(token.balanceOf(alice) > aliceBalBefore);
        assertEq(token.balanceOf(operator), 0);
    }

    // --- claimAllRewardsFor ---

    function test_claimAllRewardsFor_byOperator() public {
        vm.startPrank(alice);
        token.approve(address(staking), 2000 ether);
        staking.stake(1000 ether);
        staking.stake(1000 ether);
        staking.setOperatorApproval(operator, true);
        vm.stopPrank();

        vm.warp(block.timestamp + 30 days);

        uint256 aliceBalBefore = token.balanceOf(alice);

        vm.prank(operator);
        staking.claimAllRewardsFor(alice);

        assertTrue(token.balanceOf(alice) > aliceBalBefore);
        assertEq(token.balanceOf(operator), 0);
    }

    function test_claimAllRewardsFor_unauthorized_reverts() public {
        vm.startPrank(alice);
        token.approve(address(staking), 1000 ether);
        staking.stake(1000 ether);
        vm.stopPrank();

        vm.warp(block.timestamp + 30 days);

        vm.prank(operator);
        vm.expectRevert("Not user or approved operator");
        staking.claimAllRewardsFor(alice);
    }

    // --- Multicall ---

    function test_multicall_batchTwoStakes() public {
        vm.startPrank(alice);
        token.approve(address(staking), 2000 ether);

        bytes[] memory calls = new bytes[](2);
        calls[0] = abi.encodeWithSignature("stake(uint256)", 500 ether);
        calls[1] = abi.encodeWithSignature("stake(uint256)", 500 ether);

        staking.multicall(calls);
        vm.stopPrank();

        assertEq(staking.getStakeCount(alice), 2);
        assertEq(staking.totalStaked(), 1000 ether);
    }

    // --- Backwards Compatibility ---

    function test_stake_directlyStillWorks() public {
        vm.startPrank(alice);
        token.approve(address(staking), 1000 ether);
        staking.stake(1000 ether);
        vm.stopPrank();

        assertEq(staking.getStakeCount(alice), 1);
        assertEq(staking.totalStaked(), 1000 ether);
    }

    function test_unstake_directlyStillWorks() public {
        vm.startPrank(alice);
        token.approve(address(staking), 1000 ether);
        staking.stake(1000 ether);
        vm.stopPrank();

        vm.warp(block.timestamp + 8 days);

        vm.prank(alice);
        staking.unstake(0);

        assertEq(staking.totalStaked(), 0);
    }

    function test_claimAllRewards_directlyStillWorks() public {
        vm.startPrank(alice);
        token.approve(address(staking), 1000 ether);
        staking.stake(1000 ether);
        vm.stopPrank();

        vm.warp(block.timestamp + 30 days);

        uint256 balBefore = token.balanceOf(alice);
        vm.prank(alice);
        staking.claimAllRewards();

        assertTrue(token.balanceOf(alice) > balBefore);
    }
}
