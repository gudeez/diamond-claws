// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuardTransient.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {IPoolManager} from "@uniswap/v4-core/src/interfaces/IPoolManager.sol";
import {PoolKey} from "@uniswap/v4-core/src/types/PoolKey.sol";
import {Currency} from "@uniswap/v4-core/src/types/Currency.sol";
import {IHooks} from "@uniswap/v4-core/src/interfaces/IHooks.sol";
import {BalanceDelta} from "@uniswap/v4-core/src/types/BalanceDelta.sol";

interface IDCLAWLiquidityRouter {
    function addLiquidity(
        PoolKey calldata key,
        int24 tickLower,
        int24 tickUpper,
        int256 liquidityDelta
    ) external payable returns (BalanceDelta delta);
}

/**
 * @title DCLAWCrowdfund
 * @dev Fair launch crowdfund for Diamond Claws.
 *      Users deposit ETH during a time window. After the window closes,
 *      all ETH is paired with DCLAW to seed permanent locked liquidity.
 *      Contributors receive proportional DCLAW tokens.
 */
contract DCLAWCrowdfund is Ownable, ReentrancyGuardTransient {
    // --- Immutables ---
    IERC20 public immutable dclaw;
    IDCLAWLiquidityRouter public immutable liquidityRouter;
    IPoolManager public immutable poolManager;
    address public immutable hook;

    // --- Configuration ---
    uint256 public startTime;
    uint256 public endTime;
    uint256 public maxPerWallet;
    uint256 public minRaise;
    uint256 public dclawForLiquidity;
    uint256 public dclawForContributors;

    // --- Pool constants ---
    int24 public constant TICK_LOWER = -887220;
    int24 public constant TICK_UPPER = 887220;
    uint24 public constant POOL_FEE = 3000;
    int24 public constant TICK_SPACING = 60;

    // --- State ---
    enum State { OPEN, FINALIZED, CANCELLED }
    State public state;

    uint256 public totalDeposited;
    mapping(address => uint256) public deposits;
    mapping(address => bool) public claimed;

    uint256 public ethUsedForLP;
    uint256 public ethRefundable;

    // --- Events ---
    event Deposited(address indexed user, uint256 amount, uint256 totalUserDeposit);
    event Finalized(uint256 totalETH, uint256 ethUsed, uint256 dclawPaired, int256 liquidityDelta);
    event Claimed(address indexed user, uint256 dclawAmount, uint256 ethRefund);
    event Refunded(address indexed user, uint256 amount);
    event Cancelled();

    constructor(
        address _dclaw,
        address _liquidityRouter,
        address _poolManager,
        address _hook,
        address _owner,
        uint256 _startTime,
        uint256 _endTime,
        uint256 _maxPerWallet,
        uint256 _minRaise,
        uint256 _dclawForLiquidity,
        uint256 _dclawForContributors
    ) Ownable(_owner) {
        require(_startTime < _endTime, "Invalid time window");
        require(_endTime > block.timestamp, "End time in past");
        require(_maxPerWallet > 0, "Max per wallet must be > 0");
        require(_dclawForLiquidity > 0, "Must provide DCLAW for liquidity");

        dclaw = IERC20(_dclaw);
        liquidityRouter = IDCLAWLiquidityRouter(_liquidityRouter);
        poolManager = IPoolManager(_poolManager);
        hook = _hook;

        startTime = _startTime;
        endTime = _endTime;
        maxPerWallet = _maxPerWallet;
        minRaise = _minRaise;
        dclawForLiquidity = _dclawForLiquidity;
        dclawForContributors = _dclawForContributors;

        state = State.OPEN;
    }

    receive() external payable {}

    // --- Deposits ---

    function deposit() external payable nonReentrant {
        require(state == State.OPEN, "Not open");
        require(block.timestamp >= startTime, "Not started");
        require(block.timestamp < endTime, "Ended");
        require(msg.value > 0, "Must send ETH");
        require(deposits[msg.sender] + msg.value <= maxPerWallet, "Exceeds max per wallet");

        deposits[msg.sender] += msg.value;
        totalDeposited += msg.value;

        emit Deposited(msg.sender, msg.value, deposits[msg.sender]);
    }

    // --- Finalize ---

    function finalize(int256 liquidityDelta) external onlyOwner nonReentrant {
        require(state == State.OPEN, "Not open");
        require(block.timestamp >= endTime, "Window not closed");
        require(totalDeposited > 0, "No deposits");
        require(totalDeposited >= minRaise, "Below minimum raise");
        require(liquidityDelta > 0, "Invalid liquidity delta");

        uint256 requiredDCLAW = dclawForLiquidity + dclawForContributors;
        require(dclaw.balanceOf(address(this)) >= requiredDCLAW, "Insufficient DCLAW");

        state = State.FINALIZED;

        PoolKey memory poolKey = PoolKey({
            currency0: Currency.wrap(address(0)),
            currency1: Currency.wrap(address(dclaw)),
            fee: POOL_FEE,
            tickSpacing: TICK_SPACING,
            hooks: IHooks(hook)
        });

        // Approve PoolManager — CurrencySettler does transferFrom(this, poolManager, amount)
        dclaw.approve(address(poolManager), dclawForLiquidity);

        uint256 ethBefore = address(this).balance;

        liquidityRouter.addLiquidity{value: totalDeposited}(
            poolKey,
            TICK_LOWER,
            TICK_UPPER,
            liquidityDelta
        );

        // Router refunds unused ETH back to this contract
        // ethUsed = what we sent minus what came back
        ethUsedForLP = ethBefore - address(this).balance;
        ethRefundable = totalDeposited - ethUsedForLP;

        // Clear approval
        dclaw.approve(address(poolManager), 0);

        emit Finalized(totalDeposited, ethUsedForLP, dclawForLiquidity, liquidityDelta);
    }

    // --- Claim ---

    function claim() external nonReentrant {
        require(state == State.FINALIZED, "Not finalized");
        require(deposits[msg.sender] > 0, "No deposit");
        require(!claimed[msg.sender], "Already claimed");

        claimed[msg.sender] = true;

        uint256 userDeposit = deposits[msg.sender];
        uint256 dclawShare = (dclawForContributors * userDeposit) / totalDeposited;
        uint256 ethRefund = (ethRefundable * userDeposit) / totalDeposited;

        if (dclawShare > 0) {
            dclaw.transfer(msg.sender, dclawShare);
        }

        if (ethRefund > 0) {
            (bool sent,) = payable(msg.sender).call{value: ethRefund}("");
            require(sent, "ETH refund failed");
        }

        emit Claimed(msg.sender, dclawShare, ethRefund);
    }

    // --- Cancel / Refund ---

    function cancel() external onlyOwner {
        require(state == State.OPEN, "Not open");
        state = State.CANCELLED;
        emit Cancelled();
    }

    function refund() external nonReentrant {
        require(
            state == State.CANCELLED ||
            (state == State.OPEN && block.timestamp >= endTime && totalDeposited < minRaise),
            "Refund not available"
        );

        uint256 amount = deposits[msg.sender];
        require(amount > 0, "No deposit");

        deposits[msg.sender] = 0;
        totalDeposited -= amount;

        (bool sent,) = payable(msg.sender).call{value: amount}("");
        require(sent, "ETH refund failed");

        emit Refunded(msg.sender, amount);
    }

    // --- Owner cleanup ---

    function withdrawDCLAW() external onlyOwner {
        require(state == State.FINALIZED || state == State.CANCELLED, "Cannot withdraw yet");
        uint256 bal = dclaw.balanceOf(address(this));
        if (bal > 0) {
            dclaw.transfer(owner(), bal);
        }
    }

    function withdrawETH() external onlyOwner {
        require(state == State.FINALIZED, "Not finalized");
        uint256 bal = address(this).balance;
        if (bal > 0) {
            (bool sent,) = payable(owner()).call{value: bal}("");
            require(sent, "ETH transfer failed");
        }
    }

    // --- View functions ---

    function getClaimable(address user) external view returns (uint256 dclawAmount, uint256 ethAmount) {
        if (state != State.FINALIZED || deposits[user] == 0 || claimed[user]) {
            return (0, 0);
        }
        uint256 userDeposit = deposits[user];
        dclawAmount = (dclawForContributors * userDeposit) / totalDeposited;
        ethAmount = (ethRefundable * userDeposit) / totalDeposited;
    }

    function isOpen() external view returns (bool) {
        return state == State.OPEN && block.timestamp >= startTime && block.timestamp < endTime;
    }

    function isRefundable() external view returns (bool) {
        return state == State.CANCELLED ||
            (state == State.OPEN && block.timestamp >= endTime && totalDeposited < minRaise);
    }
}
