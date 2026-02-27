// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {IPoolManager} from "@uniswap/v4-core/src/interfaces/IPoolManager.sol";
import {IUnlockCallback} from "@uniswap/v4-core/src/interfaces/callback/IUnlockCallback.sol";
import {PoolKey} from "@uniswap/v4-core/src/types/PoolKey.sol";
import {PoolId, PoolIdLibrary} from "@uniswap/v4-core/src/types/PoolId.sol";
import {ModifyLiquidityParams} from "@uniswap/v4-core/src/types/PoolOperation.sol";
import {BalanceDelta, BalanceDeltaLibrary} from "@uniswap/v4-core/src/types/BalanceDelta.sol";
import {Currency, CurrencyLibrary} from "@uniswap/v4-core/src/types/Currency.sol";
import {CurrencySettler} from "@openzeppelin/uniswap-hooks/utils/CurrencySettler.sol";
import {StateLibrary} from "@uniswap/v4-core/src/libraries/StateLibrary.sol";
import {TransientStateLibrary} from "@uniswap/v4-core/src/libraries/TransientStateLibrary.sol";

/**
 * @title DCLAWLiquidityRouter
 * @dev Router for adding/removing liquidity to the DCLAW/ETH Uniswap v4 pool.
 *      Tracks per-user positions using salt = bytes32(uint256(uint160(sender))).
 *      Each user can have one position per tick range.
 */
contract DCLAWLiquidityRouter is IUnlockCallback {
    using CurrencySettler for Currency;
    using CurrencyLibrary for Currency;
    using StateLibrary for IPoolManager;
    using TransientStateLibrary for IPoolManager;

    IPoolManager public immutable manager;

    struct CallbackData {
        address sender;
        PoolKey key;
        ModifyLiquidityParams params;
    }

    struct Position {
        int24 tickLower;
        int24 tickUpper;
        uint128 liquidity;
    }

    // user => array of positions
    mapping(address => Position[]) public userPositions;

    // Operator delegation: user => operator => approved
    mapping(address => mapping(address => bool)) public operatorApprovals;

    event LiquidityAdded(address indexed user, int24 tickLower, int24 tickUpper, uint128 liquidity);
    event LiquidityRemoved(address indexed user, int24 tickLower, int24 tickUpper, uint128 liquidity);
    event OperatorApprovalSet(address indexed user, address indexed operator, bool approved);

    modifier onlyUserOrOperator(address user) {
        require(
            msg.sender == user || operatorApprovals[user][msg.sender],
            "Not user or approved operator"
        );
        _;
    }

    constructor(IPoolManager _manager) {
        manager = _manager;
    }

    receive() external payable {}

    /// @notice Add liquidity to the DCLAW/ETH pool
    function addLiquidity(
        PoolKey calldata key,
        int24 tickLower,
        int24 tickUpper,
        int256 liquidityDelta
    ) external payable returns (BalanceDelta delta) {
        require(liquidityDelta > 0, "Must add positive liquidity");

        bytes32 salt = bytes32(uint256(uint160(msg.sender)));

        ModifyLiquidityParams memory params = ModifyLiquidityParams({
            tickLower: tickLower,
            tickUpper: tickUpper,
            liquidityDelta: liquidityDelta,
            salt: salt
        });

        delta = abi.decode(
            manager.unlock(abi.encode(CallbackData(msg.sender, key, params))),
            (BalanceDelta)
        );

        // Track the position
        _upsertPosition(msg.sender, key, tickLower, tickUpper);

        // Return excess ETH
        uint256 ethBalance = address(this).balance;
        if (ethBalance > 0) {
            (bool sent,) = msg.sender.call{value: ethBalance}("");
            require(sent, "ETH refund failed");
        }

        emit LiquidityAdded(msg.sender, tickLower, tickUpper, uint128(uint256(liquidityDelta)));
    }

    /// @notice Remove liquidity from the DCLAW/ETH pool
    function removeLiquidity(
        PoolKey calldata key,
        int24 tickLower,
        int24 tickUpper,
        int256 liquidityDelta
    ) external returns (BalanceDelta delta) {
        require(liquidityDelta < 0, "Must remove negative liquidity");

        bytes32 salt = bytes32(uint256(uint160(msg.sender)));

        ModifyLiquidityParams memory params = ModifyLiquidityParams({
            tickLower: tickLower,
            tickUpper: tickUpper,
            liquidityDelta: liquidityDelta,
            salt: salt
        });

        delta = abi.decode(
            manager.unlock(abi.encode(CallbackData(msg.sender, key, params))),
            (BalanceDelta)
        );

        // Update tracked position
        _upsertPosition(msg.sender, key, tickLower, tickUpper);

        // Send received tokens to user
        uint256 ethBalance = address(this).balance;
        if (ethBalance > 0) {
            (bool sent,) = msg.sender.call{value: ethBalance}("");
            require(sent, "ETH send failed");
        }

        emit LiquidityRemoved(msg.sender, tickLower, tickUpper, uint128(uint256(-liquidityDelta)));
    }

    // --- Operator Delegation ---

    /// @notice Approve or revoke an operator to act on behalf of msg.sender
    function setOperatorApproval(address operator, bool approved) external {
        operatorApprovals[msg.sender][operator] = approved;
        emit OperatorApprovalSet(msg.sender, operator, approved);
    }

    // --- On-Behalf-Of Functions (for smart accounts / agents) ---

    /// @notice Add liquidity on behalf of a user. Position is attributed to `user`, ETH refunds go to `user`.
    function addLiquidityFor(
        address user,
        PoolKey calldata key,
        int24 tickLower,
        int24 tickUpper,
        int256 liquidityDelta
    ) external payable onlyUserOrOperator(user) returns (BalanceDelta delta) {
        require(liquidityDelta > 0, "Must add positive liquidity");

        bytes32 salt = bytes32(uint256(uint160(user)));

        ModifyLiquidityParams memory params = ModifyLiquidityParams({
            tickLower: tickLower,
            tickUpper: tickUpper,
            liquidityDelta: liquidityDelta,
            salt: salt
        });

        delta = abi.decode(
            manager.unlock(abi.encode(CallbackData(user, key, params))),
            (BalanceDelta)
        );

        _upsertPosition(user, key, tickLower, tickUpper);

        uint256 ethBalance = address(this).balance;
        if (ethBalance > 0) {
            (bool sent,) = user.call{value: ethBalance}("");
            require(sent, "ETH refund failed");
        }

        emit LiquidityAdded(user, tickLower, tickUpper, uint128(uint256(liquidityDelta)));
    }

    /// @notice Remove liquidity on behalf of a user. Tokens and ETH go to `user`.
    function removeLiquidityFor(
        address user,
        PoolKey calldata key,
        int24 tickLower,
        int24 tickUpper,
        int256 liquidityDelta
    ) external onlyUserOrOperator(user) returns (BalanceDelta delta) {
        require(liquidityDelta < 0, "Must remove negative liquidity");

        bytes32 salt = bytes32(uint256(uint160(user)));

        ModifyLiquidityParams memory params = ModifyLiquidityParams({
            tickLower: tickLower,
            tickUpper: tickUpper,
            liquidityDelta: liquidityDelta,
            salt: salt
        });

        delta = abi.decode(
            manager.unlock(abi.encode(CallbackData(user, key, params))),
            (BalanceDelta)
        );

        _upsertPosition(user, key, tickLower, tickUpper);

        uint256 ethBalance = address(this).balance;
        if (ethBalance > 0) {
            (bool sent,) = user.call{value: ethBalance}("");
            require(sent, "ETH send failed");
        }

        emit LiquidityRemoved(user, tickLower, tickUpper, uint128(uint256(-liquidityDelta)));
    }

    // --- View Functions ---

    /// @notice Get all positions for a user
    function getPositionCount(address user) external view returns (uint256) {
        return userPositions[user].length;
    }

    /// @notice Get a specific position for a user
    function getPosition(address user, uint256 index) external view returns (int24 tickLower, int24 tickUpper, uint128 liquidity) {
        Position storage pos = userPositions[user][index];
        return (pos.tickLower, pos.tickUpper, pos.liquidity);
    }

    /// @notice Query on-chain position info from PoolManager
    function getPositionLiquidity(
        PoolKey calldata key,
        address user,
        int24 tickLower,
        int24 tickUpper
    ) external view returns (uint128 liquidity) {
        bytes32 salt = bytes32(uint256(uint160(user)));
        (liquidity,,) = manager.getPositionInfo(
            PoolIdLibrary.toId(key),
            address(this),
            tickLower,
            tickUpper,
            salt
        );
    }

    // --- IUnlockCallback ---

    function unlockCallback(bytes calldata rawData) external returns (bytes memory) {
        require(msg.sender == address(manager), "Only PoolManager");

        CallbackData memory data = abi.decode(rawData, (CallbackData));

        (BalanceDelta delta,) = manager.modifyLiquidity(data.key, data.params, "");

        // Settle: negative delta = we owe tokens to the pool
        int128 d0 = delta.amount0();
        int128 d1 = delta.amount1();

        if (d0 < 0) data.key.currency0.settle(manager, data.sender, uint256(uint128(-d0)), false);
        if (d1 < 0) data.key.currency1.settle(manager, data.sender, uint256(uint128(-d1)), false);
        if (d0 > 0) data.key.currency0.take(manager, data.sender, uint256(uint128(d0)), false);
        if (d1 > 0) data.key.currency1.take(manager, data.sender, uint256(uint128(d1)), false);

        return abi.encode(delta);
    }

    // --- Internal ---

    function _upsertPosition(address user, PoolKey calldata key, int24 tickLower, int24 tickUpper) internal {
        bytes32 salt = bytes32(uint256(uint160(user)));
        (uint128 liq,,) = manager.getPositionInfo(
            PoolIdLibrary.toId(key),
            address(this),
            tickLower,
            tickUpper,
            salt
        );

        Position[] storage positions = userPositions[user];
        for (uint256 i = 0; i < positions.length; i++) {
            if (positions[i].tickLower == tickLower && positions[i].tickUpper == tickUpper) {
                if (liq == 0) {
                    // Remove: swap with last and pop
                    positions[i] = positions[positions.length - 1];
                    positions.pop();
                } else {
                    positions[i].liquidity = liq;
                }
                return;
            }
        }

        // New position
        if (liq > 0) {
            positions.push(Position({tickLower: tickLower, tickUpper: tickUpper, liquidity: liq}));
        }
    }
}
