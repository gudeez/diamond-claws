// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/utils/cryptography/SignatureChecker.sol";

/// @notice Minimal interface for the ERC-8004 Identity Registry
interface IIdentityRegistry {
    function register(string calldata agentURI) external returns (uint256 agentId);
    function setAgentWallet(uint256 agentId, address wallet) external;
    function getAgentWallet(uint256 agentId) external view returns (address);
    function ownerOf(uint256 tokenId) external view returns (address);
}

/**
 * @title AgentRegistry
 * @dev Lightweight integration with ERC-8004 Identity Registry for the Diamond Claws protocol.
 *      Stores the protocol's agentId after registration with the Identity Registry.
 *      Provides signature verification supporting both EOA (ECDSA) and smart account (ERC-1271) signers.
 */
contract AgentRegistry is Ownable {
    /// @notice Address of the ERC-8004 Identity Registry (can be updated by owner)
    address public identityRegistry;

    /// @notice The protocol's agentId in the Identity Registry (0 if not registered)
    uint256 public agentId;

    /// @notice The protocol's agent wallet address
    address public agentWallet;

    event IdentityRegistrySet(address indexed registry);
    event Registered(uint256 indexed agentId, string agentURI);
    event AgentWalletUpdated(address indexed newWallet);

    constructor(address _owner) Ownable(_owner) {}

    /// @notice Set the Identity Registry address
    function setIdentityRegistry(address _registry) external onlyOwner {
        require(_registry != address(0), "Invalid registry");
        identityRegistry = _registry;
        emit IdentityRegistrySet(_registry);
    }

    /// @notice Register this protocol with the Identity Registry
    /// @param agentURI URI pointing to the agent card (e.g., "https://diamondclaws.xyz/.well-known/agent-card.json")
    function register(string calldata agentURI) external onlyOwner {
        require(identityRegistry != address(0), "Registry not set");
        require(agentId == 0, "Already registered");

        agentId = IIdentityRegistry(identityRegistry).register(agentURI);
        emit Registered(agentId, agentURI);
    }

    /// @notice Set the agent wallet address
    function setAgentWallet(address _wallet) external onlyOwner {
        require(_wallet != address(0), "Invalid wallet");
        agentWallet = _wallet;
        emit AgentWalletUpdated(_wallet);
    }

    /// @notice Verify a signature from the protocol's agent wallet.
    ///         Supports both EOA (ECDSA) and smart account (ERC-1271) signatures.
    /// @param hash The hash that was signed
    /// @param signature The signature bytes
    /// @return True if the signature is valid from the agent wallet
    function isValidAgentSignature(bytes32 hash, bytes memory signature) external view returns (bool) {
        require(agentWallet != address(0), "Agent wallet not set");
        return SignatureChecker.isValidSignatureNow(agentWallet, hash, signature);
    }

    /// @notice Check if an address is the registered agent wallet
    function isAgentWallet(address wallet) external view returns (bool) {
        return agentWallet != address(0) && wallet == agentWallet;
    }
}
