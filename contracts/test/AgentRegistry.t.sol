// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {AgentRegistry} from "../contracts/AgentRegistry.sol";

contract AgentRegistryTest is Test {
    AgentRegistry registry;
    address owner = address(0xA);
    address agentWallet;
    uint256 agentWalletPk;

    function setUp() public {
        (agentWallet, agentWalletPk) = makeAddrAndKey("agent");
        registry = new AgentRegistry(owner);
    }

    // --- Agent Wallet ---

    function test_setAgentWallet() public {
        vm.prank(owner);
        registry.setAgentWallet(agentWallet);
        assertEq(registry.agentWallet(), agentWallet);
    }

    function test_isAgentWallet_true() public {
        vm.prank(owner);
        registry.setAgentWallet(agentWallet);
        assertTrue(registry.isAgentWallet(agentWallet));
    }

    function test_isAgentWallet_false() public {
        vm.prank(owner);
        registry.setAgentWallet(agentWallet);
        assertFalse(registry.isAgentWallet(address(0xBAD)));
    }

    function test_isAgentWallet_notSet() public view {
        assertFalse(registry.isAgentWallet(agentWallet));
    }

    function test_setAgentWallet_zeroReverts() public {
        vm.prank(owner);
        vm.expectRevert("Invalid wallet");
        registry.setAgentWallet(address(0));
    }

    // --- Signature Verification ---

    function test_isValidAgentSignature_EOA() public {
        vm.prank(owner);
        registry.setAgentWallet(agentWallet);

        bytes32 testHash = keccak256("test message");
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(agentWalletPk, testHash);
        bytes memory sig = abi.encodePacked(r, s, v);

        assertTrue(registry.isValidAgentSignature(testHash, sig));
    }

    function test_isValidAgentSignature_wrongSigner() public {
        vm.prank(owner);
        registry.setAgentWallet(agentWallet);

        (, uint256 wrongPk) = makeAddrAndKey("wrong");
        bytes32 testHash = keccak256("test message");
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(wrongPk, testHash);
        bytes memory sig = abi.encodePacked(r, s, v);

        assertFalse(registry.isValidAgentSignature(testHash, sig));
    }

    function test_isValidAgentSignature_walletNotSet_reverts() public {
        bytes32 testHash = keccak256("test");
        vm.expectRevert("Agent wallet not set");
        registry.isValidAgentSignature(testHash, "");
    }

    // --- Identity Registry ---

    function test_setIdentityRegistry() public {
        address mockRegistry = address(0x1234);
        vm.prank(owner);
        registry.setIdentityRegistry(mockRegistry);
        assertEq(registry.identityRegistry(), mockRegistry);
    }

    function test_setIdentityRegistry_zeroReverts() public {
        vm.prank(owner);
        vm.expectRevert("Invalid registry");
        registry.setIdentityRegistry(address(0));
    }

    function test_register_noRegistryReverts() public {
        vm.prank(owner);
        vm.expectRevert("Registry not set");
        registry.register("https://example.com/agent-card.json");
    }

    // --- Access Control ---

    function test_onlyOwner_setAgentWallet() public {
        vm.prank(address(0xBAD));
        vm.expectRevert();
        registry.setAgentWallet(agentWallet);
    }

    function test_onlyOwner_setIdentityRegistry() public {
        vm.prank(address(0xBAD));
        vm.expectRevert();
        registry.setIdentityRegistry(address(0x1));
    }

    function test_onlyOwner_register() public {
        vm.prank(address(0xBAD));
        vm.expectRevert();
        registry.register("https://example.com/agent-card.json");
    }

    // --- Initial State ---

    function test_initialState() public view {
        assertEq(registry.identityRegistry(), address(0));
        assertEq(registry.agentId(), 0);
        assertEq(registry.agentWallet(), address(0));
    }
}
