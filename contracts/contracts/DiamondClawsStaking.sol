// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

/**
 * @title DiamondClawsStaking
 * @dev Staking contract for Diamond Claws token with 5% unstake tax
 */
contract DiamondClawsStaking is Ownable, ReentrancyGuard {
    using SafeERC20 for IERC20;
    
    // Token interfaces
    IERC20 public immutable stakeToken; // DCLAW
    
    // Staking state
    struct StakeInfo {
        uint256 amount;
        uint256 startTime;
        uint256 rewards;
    }
    
    mapping(address => StakeInfo[]) public userStakes;
    mapping(address => uint256) public pendingRewards;
    
    // Reward configuration
    uint256 public rewardRateAPY = 365; // 365% APY (roughly 1% per day)
    uint256 public constant REWARD_PRECISION = 10000;
    
    // Tax configuration
    uint256 public constant UNSTAKE_TAX_BP = 500; // 5% tax on unstaking
    uint256 public constant EARLY_UNSTAKE_TAX_BP = 1000; // 10% if < 7 days
    uint256 public constant EARLY_UNSTAKE_DURATION = 7 days;
    
    address public taxWallet;
    uint256 public totalStaked;
    
    // Events
    event Staked(address indexed user, uint256 amount, uint256 stakeId);
    event Unstaked(address indexed user, uint256 amount, uint256 stakeId, uint256 taxPaid);
    event RewardClaimed(address indexed user, uint256 reward);
    event RewardRateUpdated(uint256 newRate);
    event TaxWalletUpdated(address indexed newTaxWallet);
    
    constructor(address _stakeToken, address _taxWallet, address _initialOwner) 
        Ownable(_initialOwner) 
    {
        require(_stakeToken != address(0), "Invalid stake token");
        require(_taxWallet != address(0), "Invalid tax wallet");
        
        stakeToken = IERC20(_stakeToken);
        taxWallet = _taxWallet;
    }
    
    /**
     * @dev Stake DCLAW tokens
     */
    function stake(uint256 amount) external nonReentrant {
        require(amount > 0, "Cannot stake 0");
        
        // Transfer tokens from user
        stakeToken.safeTransferFrom(msg.sender, address(this), amount);
        
        // Create new stake
        StakeInfo memory newStake = StakeInfo({
            amount: amount,
            startTime: block.timestamp,
            rewards: 0
        });
        
        userStakes[msg.sender].push(newStake);
        totalStaked += amount;
        
        emit Staked(msg.sender, amount, userStakes[msg.sender].length - 1);
    }
    
    /**
     * @dev Unstake tokens with tax
     */
    function unstake(uint256 stakeId) external nonReentrant {
        require(stakeId < userStakes[msg.sender].length, "Invalid stake ID");
        
        StakeInfo storage stakeInfo = userStakes[msg.sender][stakeId];
        require(stakeInfo.amount > 0, "Already unstaked");
        
        // Calculate rewards before unstaking
        uint256 rewards = calculateRewards(msg.sender, stakeId);
        
        // Calculate unstake tax
        uint256 taxAmount = calculateUnstakeTax(stakeInfo.amount, stakeInfo.startTime);
        uint256 receiveAmount = stakeInfo.amount - taxAmount;
        
        // Update state
        totalStaked -= stakeInfo.amount;
        stakeInfo.amount = 0;
        
        // Transfer tokens
        if (taxAmount > 0) {
            stakeToken.safeTransfer(taxWallet, taxAmount);
        }
        stakeToken.safeTransfer(msg.sender, receiveAmount);
        
        // Claim any pending rewards
        if (rewards > 0) {
            _claimRewardsInternal(msg.sender, rewards);
        }
        
        emit Unstaked(msg.sender, stakeInfo.amount, stakeId, taxAmount);
    }
    
    /**
     * @dev Claim rewards from a specific stake
     */
    function claimRewards(uint256 stakeId) external nonReentrant {
        require(stakeId < userStakes[msg.sender].length, "Invalid stake ID");
        
        uint256 rewards = calculateRewards(msg.sender, stakeId);
        require(rewards > 0, "No rewards to claim");
        
        _claimRewardsInternal(msg.sender, rewards);
    }
    
    /**
     * @dev Claim all pending rewards
     */
    function claimAllRewards() external nonReentrant {
        uint256 totalReward = pendingRewards[msg.sender];
        
        // Calculate pending from all stakes
        StakeInfo[] storage stakes = userStakes[msg.sender];
        for (uint256 i = 0; i < stakes.length; i++) {
            if (stakes[i].amount > 0) {
                uint256 stakeReward = calculateRewards(msg.sender, i);
                totalReward += stakeReward;
            }
        }
        
        require(totalReward > 0, "No rewards to claim");
        
        pendingRewards[msg.sender] = 0;
        
        // Mint rewards (requires token to have minter role for staking contract)
        stakeToken.safeTransfer(msg.sender, totalReward);
        
        emit RewardClaimed(msg.sender, totalReward);
    }
    
    /**
     * @dev Internal claim rewards
     */
    function _claimRewardsInternal(address user, uint256 rewards) internal {
        pendingRewards[user] = 0;
        
        // Mint rewards to user
        stakeToken.safeTransfer(user, rewards);
        
        emit RewardClaimed(user, rewards);
    }
    
    /**
     * @dev Calculate unstake tax
     */
    function calculateUnstakeTax(uint256 amount, uint256 startTime) public view returns (uint256) {
        uint256 taxBP = UNSTAKE_TAX_BP;
        
        // Early unstake penalty
        if (block.timestamp < startTime + EARLY_UNSTAKE_DURATION) {
            taxBP = EARLY_UNSTAKE_TAX_BP;
        }
        
        return (amount * taxBP) / REWARD_PRECISION;
    }
    
    /**
     * @dev Calculate rewards for a stake
     */
    function calculateRewards(address user, uint256 stakeId) public view returns (uint256) {
        StakeInfo[] storage stakes = userStakes[user];
        require(stakeId < stakes.length, "Invalid stake ID");
        
        StakeInfo storage stakeInfo = stakes[stakeId];
        if (stakeInfo.amount == 0) return 0;
        
        uint256 stakingDuration = block.timestamp - stakeInfo.startTime;
        uint256 dailyRate = (rewardRateAPY * REWARD_PRECISION) / (365 * REWARD_PRECISION);
        
        // Calculate rewards: amount * rate * days
        uint256 rewards = (stakeInfo.amount * dailyRate * stakingDuration) / (REWARD_PRECISION * 1 days);
        
        return rewards;
    }
    
    /**
     * @dev Get user stake count
     */
    function getStakeCount(address user) external view returns (uint256) {
        return userStakes[user].length;
    }
    
    /**
     * @dev Get user stake info
     */
    function getStakeInfo(address user, uint256 stakeId) external view returns (
        uint256 amount,
        uint256 startTime,
        uint256 rewards
    ) {
        require(stakeId < userStakes[user].length, "Invalid stake ID");
        StakeInfo storage stakeInfo = userStakes[user][stakeId];
        uint256 pendingRewards = calculateRewards(user, stakeId);
        return (stakeInfo.amount, stakeInfo.startTime, pendingRewards);
    }
    
    /**
     * @dev Get total pending rewards for user
     */
    function getTotalPendingRewards(address user) external view returns (uint256) {
        uint256 total = pendingRewards[user];
        StakeInfo[] storage stakes = userStakes[user];
        
        for (uint256 i = 0; i < stakes.length; i++) {
            if (stakes[i].amount > 0) {
                total += calculateRewards(user, i);
            }
        }
        
        return total;
    }
    
    /**
     * @dev Update reward rate
     */
    function setRewardRate(uint256 _rewardRateAPY) external onlyOwner {
        require(_rewardRateAPY <= 1000, "APY too high"); // Max 1000%
        rewardRateAPY = _rewardRateAPY;
        emit RewardRateUpdated(_rewardRateAPY);
    }
    
    /**
     * @dev Set tax wallet
     */
    function setTaxWallet(address _taxWallet) external onlyOwner {
        require(_taxWallet != address(0), "Invalid tax wallet");
        taxWallet = _taxWallet;
        emit TaxWalletUpdated(_taxWallet);
    }
    
    /**
     * @dev Emergency withdraw tokens
     */
    function emergencyWithdraw(address token, uint256 amount) external onlyOwner {
        IERC20(token).safeTransfer(owner(), amount);
    }
}
