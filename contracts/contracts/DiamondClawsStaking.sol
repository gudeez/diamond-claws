// SPDX-License-Identifier: MIT
pragma solidity ^0.8.27;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

interface IDiamondClaws {
    function mint(address to, uint256 amount) external;
}

/**
 * @title DiamondClawsStaking
 * @dev Staking contract for Diamond Claws token with unstake tax and minted rewards.
 *      Rewards are minted via the DCLAW token's onlyStaking mint function.
 *      Note: Changing rewardRateAPY applies the new rate retroactively to existing
 *      stakes' unclaimed rewards. Owner should set the rate carefully.
 */
contract DiamondClawsStaking is Ownable, ReentrancyGuard {
    using SafeERC20 for IERC20;

    // Token interfaces
    IERC20 public immutable stakeToken; // DCLAW

    // Staking state
    struct StakeInfo {
        uint256 amount;
        uint256 startTime;
        uint256 rewardsClaimed;
    }

    mapping(address => StakeInfo[]) public userStakes;

    // Reward configuration
    uint256 public rewardRateAPY = 100; // 100% APY (~0.27% per day)
    uint256 public constant REWARD_PRECISION = 10000;

    // Emission limits
    uint256 public totalRewardsMinted;
    uint256 public maxTotalRewards = 100_000_000 * 10**18; // 100M tokens (10% of 1B supply)

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
    event MaxTotalRewardsUpdated(uint256 newMax);
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

        stakeToken.safeTransferFrom(msg.sender, address(this), amount);

        StakeInfo memory newStake = StakeInfo({
            amount: amount,
            startTime: block.timestamp,
            rewardsClaimed: 0
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

        // Cache amount before zeroing
        uint256 stakedAmount = stakeInfo.amount;

        // Calculate unstake tax
        uint256 taxAmount = calculateUnstakeTax(stakedAmount, stakeInfo.startTime);
        uint256 receiveAmount = stakedAmount - taxAmount;

        // Update state before transfers (CEI pattern)
        totalStaked -= stakedAmount;
        stakeInfo.amount = 0;

        // Transfer staked tokens
        if (taxAmount > 0) {
            stakeToken.safeTransfer(taxWallet, taxAmount);
        }
        stakeToken.safeTransfer(msg.sender, receiveAmount);

        // Mint any pending rewards
        if (rewards > 0) {
            _mintRewards(msg.sender, rewards);
        }

        emit Unstaked(msg.sender, stakedAmount, stakeId, taxAmount);
    }

    /**
     * @dev Claim rewards from a specific stake
     */
    function claimRewards(uint256 stakeId) external nonReentrant {
        require(stakeId < userStakes[msg.sender].length, "Invalid stake ID");

        StakeInfo storage stakeInfo = userStakes[msg.sender][stakeId];
        require(stakeInfo.amount > 0, "Stake inactive");

        uint256 rewards = calculateRewards(msg.sender, stakeId);
        require(rewards > 0, "No rewards to claim");

        // Mark rewards as claimed before minting
        stakeInfo.rewardsClaimed += rewards;

        _mintRewards(msg.sender, rewards);
    }

    /**
     * @dev Claim all pending rewards from all active stakes
     */
    function claimAllRewards() external nonReentrant {
        uint256 totalReward = 0;

        StakeInfo[] storage stakes = userStakes[msg.sender];
        for (uint256 i = 0; i < stakes.length; i++) {
            if (stakes[i].amount > 0) {
                uint256 stakeReward = calculateRewards(msg.sender, i);
                if (stakeReward > 0) {
                    stakes[i].rewardsClaimed += stakeReward;
                    totalReward += stakeReward;
                }
            }
        }

        require(totalReward > 0, "No rewards to claim");

        _mintRewards(msg.sender, totalReward);
    }

    /**
     * @dev Internal: mint rewards to user, enforcing emission cap
     */
    function _mintRewards(address user, uint256 rewards) internal {
        // Cap rewards at remaining emission budget
        uint256 remaining = maxTotalRewards - totalRewardsMinted;
        if (rewards > remaining) {
            rewards = remaining;
        }
        if (rewards == 0) return;

        totalRewardsMinted += rewards;
        IDiamondClaws(address(stakeToken)).mint(user, rewards);

        emit RewardClaimed(user, rewards);
    }

    /**
     * @dev Calculate unstake tax
     */
    function calculateUnstakeTax(uint256 amount, uint256 startTime) public view returns (uint256) {
        uint256 taxBP = UNSTAKE_TAX_BP;

        if (block.timestamp < startTime + EARLY_UNSTAKE_DURATION) {
            taxBP = EARLY_UNSTAKE_TAX_BP;
        }

        return (amount * taxBP) / REWARD_PRECISION;
    }

    /**
     * @dev Calculate unclaimed rewards for a stake.
     *      Formula: (amount * rewardRateAPY * duration) / (365 * REWARD_PRECISION * 1 days) - rewardsClaimed
     */
    function calculateRewards(address user, uint256 stakeId) public view returns (uint256) {
        StakeInfo[] storage stakes = userStakes[user];
        require(stakeId < stakes.length, "Invalid stake ID");

        StakeInfo storage stakeInfo = stakes[stakeId];
        if (stakeInfo.amount == 0) return 0;

        uint256 stakingDuration = block.timestamp - stakeInfo.startTime;

        // Single expression to maintain precision:
        // e.g. 1000e18 tokens * 100 APY * 86400s / (365 * 10000 * 86400) = ~0.0027% per day
        uint256 grossRewards = (stakeInfo.amount * rewardRateAPY * stakingDuration) / (365 * REWARD_PRECISION * 1 days);

        if (grossRewards <= stakeInfo.rewardsClaimed) return 0;
        return grossRewards - stakeInfo.rewardsClaimed;
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
        uint256 pendingReward
    ) {
        require(stakeId < userStakes[user].length, "Invalid stake ID");
        StakeInfo storage stakeInfo = userStakes[user][stakeId];
        uint256 reward = calculateRewards(user, stakeId);
        return (stakeInfo.amount, stakeInfo.startTime, reward);
    }

    /**
     * @dev Get total pending rewards for user across all stakes
     */
    function getTotalPendingRewards(address user) external view returns (uint256) {
        uint256 total = 0;
        StakeInfo[] storage stakes = userStakes[user];

        for (uint256 i = 0; i < stakes.length; i++) {
            if (stakes[i].amount > 0) {
                total += calculateRewards(user, i);
            }
        }

        return total;
    }

    /**
     * @dev Update reward rate (applies to all current and future stakes)
     */
    function setRewardRate(uint256 _rewardRateAPY) external onlyOwner {
        require(_rewardRateAPY <= 1000, "APY too high"); // Max 1000%
        rewardRateAPY = _rewardRateAPY;
        emit RewardRateUpdated(_rewardRateAPY);
    }

    /**
     * @dev Update max total reward emissions
     */
    function setMaxTotalRewards(uint256 _maxTotalRewards) external onlyOwner {
        require(_maxTotalRewards >= totalRewardsMinted, "Below already minted");
        maxTotalRewards = _maxTotalRewards;
        emit MaxTotalRewardsUpdated(_maxTotalRewards);
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
     * @dev Emergency withdraw tokens (cannot withdraw staked DCLAW below totalStaked)
     */
    function emergencyWithdraw(address token, uint256 amount) external onlyOwner {
        if (token == address(stakeToken)) {
            uint256 balance = stakeToken.balanceOf(address(this));
            require(balance - amount >= totalStaked, "Cannot withdraw staked tokens");
        }
        IERC20(token).safeTransfer(owner(), amount);
    }
}
