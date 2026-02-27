// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {DiamondClaws} from "../contracts/DiamondClaws.sol";

contract DiamondClawsTest is Test {
    DiamondClaws token;
    address owner = address(0xA);
    address taxWallet = address(0xB);
    address alice;
    uint256 alicePk;

    function setUp() public {
        (alice, alicePk) = makeAddrAndKey("alice");
        token = new DiamondClaws(owner, taxWallet);
        // Transfer some tokens to alice for testing
        vm.prank(owner);
        token.transfer(alice, 1000 ether);
    }

    // --- ERC20Permit Tests ---

    function test_permit_setsAllowance() public {
        address spender = address(0xC);
        uint256 value = 500 ether;
        uint256 deadline = block.timestamp + 1 hours;
        uint256 nonce = token.nonces(alice);

        bytes32 permitHash = keccak256(
            abi.encode(
                keccak256("Permit(address owner,address spender,uint256 value,uint256 nonce,uint256 deadline)"),
                alice,
                spender,
                value,
                nonce,
                deadline
            )
        );
        bytes32 digest = keccak256(
            abi.encodePacked("\x19\x01", token.DOMAIN_SEPARATOR(), permitHash)
        );
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(alicePk, digest);

        token.permit(alice, spender, value, deadline, v, r, s);

        assertEq(token.allowance(alice, spender), value);
        assertEq(token.nonces(alice), nonce + 1);
    }

    function test_permit_expiredReverts() public {
        address spender = address(0xC);
        uint256 deadline = block.timestamp - 1;

        bytes32 permitHash = keccak256(
            abi.encode(
                keccak256("Permit(address owner,address spender,uint256 value,uint256 nonce,uint256 deadline)"),
                alice,
                spender,
                uint256(100),
                token.nonces(alice),
                deadline
            )
        );
        bytes32 digest = keccak256(
            abi.encodePacked("\x19\x01", token.DOMAIN_SEPARATOR(), permitHash)
        );
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(alicePk, digest);

        vm.expectRevert();
        token.permit(alice, spender, 100, deadline, v, r, s);
    }

    function test_DOMAIN_SEPARATOR_isNotZero() public view {
        assertTrue(token.DOMAIN_SEPARATOR() != bytes32(0));
    }

    function test_nonces_startsAtZero() public view {
        assertEq(token.nonces(alice), 0);
    }

    // --- Backwards Compatibility ---

    function test_transferWithTax_stillWorks() public {
        vm.prank(owner);
        token.setDexPair(address(0xDEAD), true);

        vm.prank(alice);
        token.transfer(address(0xDEAD), 100 ether);

        // 8% sell tax
        uint256 taxAmount = (100 ether * 800) / 10000;
        assertEq(token.balanceOf(taxWallet), taxAmount);
    }

    function test_transferNoTax_stillWorks() public {
        address bob = address(0xE);
        uint256 balBefore = token.balanceOf(alice);

        vm.prank(alice);
        token.transfer(bob, 50 ether);

        assertEq(token.balanceOf(bob), 50 ether);
        assertEq(token.balanceOf(alice), balBefore - 50 ether);
    }

    function test_approve_stillWorks() public {
        vm.prank(alice);
        token.approve(address(0xC), 100 ether);
        assertEq(token.allowance(alice, address(0xC)), 100 ether);
    }
}
