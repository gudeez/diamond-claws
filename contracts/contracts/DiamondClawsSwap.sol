// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

/**
 * @title DiamondClawsSwap
 * @dev Simple swap contract: users send ETH, receive DCLAW at a fixed rate
 */
contract DiamondClawsSwap is Ownable, ReentrancyGuard {
    using SafeERC20 for IERC20;

    IERC20 public immutable dclawToken;

    // Rate: how many DCLAW tokens per 1 ETH (in token units, 18 decimals)
    uint256 public rate = 1_000_000 * 10**18; // 1 ETH = 1,000,000 DCLAW

    event Swapped(address indexed buyer, uint256 ethAmount, uint256 tokenAmount);
    event RateUpdated(uint256 newRate);
    event ETHWithdrawn(address indexed to, uint256 amount);
    event TokensWithdrawn(address indexed to, address token, uint256 amount);

    constructor(address _dclawToken, address _initialOwner) Ownable(_initialOwner) {
        require(_dclawToken != address(0), "Invalid token address");
        dclawToken = IERC20(_dclawToken);
    }

    /**
     * @dev Swap ETH for DCLAW tokens
     */
    function swapETHForDCLAW() external payable nonReentrant {
        require(msg.value > 0, "Must send ETH");

        uint256 tokenAmount = getAmountOut(msg.value);
        require(tokenAmount > 0, "Token amount too small");

        uint256 contractBalance = dclawToken.balanceOf(address(this));
        require(contractBalance >= tokenAmount, "Insufficient DCLAW liquidity");

        dclawToken.safeTransfer(msg.sender, tokenAmount);

        emit Swapped(msg.sender, msg.value, tokenAmount);
    }

    /**
     * @dev Calculate DCLAW output for a given ETH input
     */
    function getAmountOut(uint256 ethAmount) public view returns (uint256) {
        return (ethAmount * rate) / 1 ether;
    }

    /**
     * @dev Get available DCLAW liquidity
     */
    function availableLiquidity() external view returns (uint256) {
        return dclawToken.balanceOf(address(this));
    }

    /**
     * @dev Update the exchange rate
     */
    function setRate(uint256 _rate) external onlyOwner {
        require(_rate > 0, "Rate must be positive");
        rate = _rate;
        emit RateUpdated(_rate);
    }

    /**
     * @dev Withdraw ETH collected from swaps
     */
    function withdrawETH() external onlyOwner {
        uint256 balance = address(this).balance;
        require(balance > 0, "No ETH to withdraw");
        payable(owner()).transfer(balance);
        emit ETHWithdrawn(owner(), balance);
    }

    /**
     * @dev Withdraw tokens (for recovering DCLAW or accidental tokens)
     */
    function withdrawTokens(address token, uint256 amount) external onlyOwner {
        IERC20(token).safeTransfer(owner(), amount);
        emit TokensWithdrawn(owner(), token, amount);
    }

    receive() external payable {
        // Accept ETH deposits for funding
    }
}
