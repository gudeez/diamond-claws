// SPDX-License-Identifier: MIT
pragma solidity ^0.8.27;

import {BaseAsyncSwap} from "@openzeppelin/uniswap-hooks/base/BaseAsyncSwap.sol";
import {BaseHook} from "@openzeppelin/uniswap-hooks/base/BaseHook.sol";
import {CurrencySettler} from "@openzeppelin/uniswap-hooks/utils/CurrencySettler.sol";
import {IPoolManager} from "@uniswap/v4-core/src/interfaces/IPoolManager.sol";
import {IUnlockCallback} from "@uniswap/v4-core/src/interfaces/callback/IUnlockCallback.sol";
import {Hooks} from "@uniswap/v4-core/src/libraries/Hooks.sol";
import {PoolKey} from "@uniswap/v4-core/src/types/PoolKey.sol";
import {PoolId, PoolIdLibrary} from "@uniswap/v4-core/src/types/PoolId.sol";
import {Currency} from "@uniswap/v4-core/src/types/Currency.sol";
import {BeforeSwapDelta} from "@uniswap/v4-core/src/types/BeforeSwapDelta.sol";
import {SwapParams} from "@uniswap/v4-core/src/types/PoolOperation.sol";
import {SafeCast} from "@uniswap/v4-core/src/libraries/SafeCast.sol";
import {TransientStateLibrary} from "@uniswap/v4-core/src/libraries/TransientStateLibrary.sol";

/**
 * @title DCLAWSwap
 * @dev Uniswap v4 hook for DCLAW token swaps using BaseAsyncSwap.
 *      Queues exact-input swaps into a batch and allows a keeper to execute
 *      them together, providing MEV protection via batched settlement.
 *
 *      Flow:
 *      1. User initiates exact-input swap → _beforeSwap intercepts and queues it
 *      2. ERC-6909 claim tokens are minted to the hook (handled by BaseAsyncSwap)
 *      3. Keeper calls executeBatch() → settles all queued swaps through the pool
 *      4. Users receive output tokens proportional to their input contribution
 */
contract DCLAWSwap is BaseAsyncSwap, IUnlockCallback {
    using SafeCast for uint256;
    using CurrencySettler for Currency;
    using TransientStateLibrary for IPoolManager;

    // --- Errors ---
    error NotKeeper();
    error EmptyBatch();
    error SwapExpired();
    error BatchAlreadyInProgress();

    // --- Events ---
    event SwapQueued(
        PoolId indexed poolId,
        address indexed sender,
        uint256 amountIn,
        bool zeroForOne,
        uint256 batchIndex
    );
    event BatchExecuted(PoolId indexed poolId, uint256 batchId, uint256 totalSwaps, uint256 totalInput);
    event KeeperUpdated(address indexed oldKeeper, address indexed newKeeper);
    event SwapFeeUpdated(uint256 newFeeBP);
    event SwapExpiryUpdated(uint256 newExpiry);

    // --- Structs ---
    struct SwapIntent {
        address sender;      // Who initiated the swap
        uint256 amountIn;    // Input amount (specified currency)
        bool zeroForOne;     // Swap direction
        uint256 timestamp;   // When the swap was queued
    }

    // --- State ---
    address public keeper;
    uint256 public swapFeeBP = 30; // 0.3% fee in basis points (paid to LPs)
    uint256 public swapExpiry = 1 hours; // Queued swaps expire after this duration
    uint256 public batchCounter;

    // Pool-specific swap queues (PoolId => SwapIntent[])
    mapping(bytes32 => SwapIntent[]) internal _swapQueues;

    // Per-pool ERC-6909 claim tracking to prevent cross-pool drainage
    mapping(bytes32 => mapping(Currency => uint256)) internal _poolClaims;

    // --- Modifiers ---
    modifier onlyKeeper() {
        if (msg.sender != keeper) revert NotKeeper();
        _;
    }

    constructor(IPoolManager _poolManager, address _keeper) BaseHook(_poolManager) {
        keeper = _keeper;
    }

    // --- Hook Permissions ---
    function getHookPermissions() public pure override returns (Hooks.Permissions memory) {
        return Hooks.Permissions({
            beforeInitialize: false,
            afterInitialize: false,
            beforeAddLiquidity: false,
            beforeRemoveLiquidity: false,
            afterAddLiquidity: false,
            afterRemoveLiquidity: false,
            beforeSwap: true,
            afterSwap: false,
            beforeDonate: false,
            afterDonate: false,
            beforeSwapReturnDelta: true,
            afterSwapReturnDelta: false,
            afterAddLiquidityReturnDelta: false,
            afterRemoveLiquidityReturnDelta: false
        });
    }

    // --- Core Hook Logic ---

    /**
     * @dev Override _beforeSwap to queue exact-input swaps.
     *      BaseAsyncSwap handles minting ERC-6909 claims and returning the delta.
     *      We add the swap to our queue and track per-pool claims.
     */
    function _beforeSwap(
        address sender,
        PoolKey calldata key,
        SwapParams calldata params,
        bytes calldata hookData
    ) internal override returns (bytes4, BeforeSwapDelta, uint24) {
        // Only intercept exact-input swaps (amountSpecified < 0)
        // Exact-output swaps pass through to normal pool logic via BaseAsyncSwap
        if (params.amountSpecified < 0) {
            uint256 specifiedAmount = uint256(-params.amountSpecified);
            Currency specified = params.zeroForOne ? key.currency0 : key.currency1;

            // Track per-pool claims
            bytes32 poolIdBytes = bytes32(PoolId.unwrap(key.toId()));
            _poolClaims[poolIdBytes][specified] += specifiedAmount;

            // Queue the swap intent
            _swapQueues[poolIdBytes].push(SwapIntent({
                sender: sender,
                amountIn: specifiedAmount,
                zeroForOne: params.zeroForOne,
                timestamp: block.timestamp
            }));

            emit SwapQueued(
                key.toId(),
                sender,
                specifiedAmount,
                params.zeroForOne,
                _swapQueues[poolIdBytes].length - 1
            );
        }

        // Let BaseAsyncSwap handle the delta math and ERC-6909 minting
        return super._beforeSwap(sender, key, params, hookData);
    }

    /**
     * @dev Calculate swap fee for LP compensation.
     */
    function _calculateSwapFee(
        PoolKey calldata,
        uint256 specifiedAmount
    ) internal view override returns (uint256) {
        return (specifiedAmount * swapFeeBP) / 10000;
    }

    // --- Batch Execution ---

    /**
     * @dev Execute all queued swaps for a pool in a single batch.
     *      The keeper calls this to settle queued swap intents through the PoolManager.
     *
     *      For each swap intent:
     *      - Burns the ERC-6909 claim tokens (settling input side)
     *      - Executes the swap through the pool
     *      - Sends output tokens to the original sender
     *
     * @param key The pool key to execute the batch for
     */
    function executeBatch(PoolKey calldata key) external onlyKeeper {
        bytes32 poolIdBytes = bytes32(PoolId.unwrap(key.toId()));
        SwapIntent[] storage queue = _swapQueues[poolIdBytes];
        if (queue.length == 0) revert EmptyBatch();

        // Copy queue to memory and clear storage
        SwapIntent[] memory batch = new SwapIntent[](queue.length);
        for (uint256 i = 0; i < queue.length; i++) {
            batch[i] = queue[i];
        }
        delete _swapQueues[poolIdBytes];

        // Encode the batch data for the unlock callback
        bytes memory callbackData = abi.encode(key, batch, poolIdBytes);

        // Execute within PoolManager unlock context
        poolManager.unlock(callbackData);

        batchCounter++;
    }

    /**
     * @dev Callback from PoolManager.unlock() — settles each swap in the batch.
     */
    function unlockCallback(bytes calldata data) external override returns (bytes memory) {
        if (msg.sender != address(poolManager)) revert NotPoolManager();

        (PoolKey memory key, SwapIntent[] memory batch, bytes32 poolIdBytes) =
            abi.decode(data, (PoolKey, SwapIntent[], bytes32));

        uint256 totalInput;
        uint256 executed;

        for (uint256 i = 0; i < batch.length; i++) {
            SwapIntent memory intent = batch[i];

            // Skip expired swaps
            if (block.timestamp > intent.timestamp + swapExpiry) continue;

            Currency inputCurrency = intent.zeroForOne ? key.currency0 : key.currency1;
            Currency outputCurrency = intent.zeroForOne ? key.currency1 : key.currency0;

            // Burn the ERC-6909 claims (settle input debt to the pool)
            inputCurrency.settle(poolManager, address(this), intent.amountIn, true);

            // Execute the swap through the pool
            poolManager.swap(
                key,
                SwapParams({
                    zeroForOne: intent.zeroForOne,
                    amountSpecified: -int256(intent.amountIn),
                    sqrtPriceLimitX96: intent.zeroForOne
                        ? 4295128739 + 1     // MIN_SQRT_PRICE + 1
                        : 1461446703485210103287273052203988822378723970342 - 1 // MAX_SQRT_PRICE - 1
                }),
                bytes("")
            );

            // Take output tokens and send to the user
            uint256 outputAmount = _getOutputDelta(outputCurrency);
            if (outputAmount > 0) {
                outputCurrency.take(poolManager, intent.sender, outputAmount, false);
            }

            // Decrease per-pool claim tracking
            _poolClaims[poolIdBytes][inputCurrency] -= intent.amountIn;

            totalInput += intent.amountIn;
            executed++;
        }

        emit BatchExecuted(key.toId(), batchCounter, executed, totalInput);

        return bytes("");
    }

    /**
     * @dev Read the PoolManager's delta for a currency to determine output amount.
     */
    function _getOutputDelta(Currency currency) internal view returns (uint256) {
        int256 delta = TransientStateLibrary.currencyDelta(poolManager, address(this), currency);
        // A negative delta means the pool owes us tokens (output)
        return delta < 0 ? uint256(-delta) : 0;
    }

    // --- View Functions ---

    /**
     * @dev Get the number of queued swaps for a pool.
     */
    function getQueueLength(PoolKey calldata key) external view returns (uint256) {
        return _swapQueues[bytes32(PoolId.unwrap(key.toId()))].length;
    }

    /**
     * @dev Get a specific queued swap intent.
     */
    function getSwapIntent(PoolKey calldata key, uint256 index)
        external
        view
        returns (address sender, uint256 amountIn, bool zeroForOne, uint256 timestamp)
    {
        SwapIntent storage intent = _swapQueues[bytes32(PoolId.unwrap(key.toId()))][index];
        return (intent.sender, intent.amountIn, intent.zeroForOne, intent.timestamp);
    }

    /**
     * @dev Get per-pool ERC-6909 claim balance for a currency.
     */
    function getPoolClaims(PoolKey calldata key, Currency currency) external view returns (uint256) {
        return _poolClaims[bytes32(PoolId.unwrap(key.toId()))][currency];
    }

    // --- Admin Functions ---

    function setKeeper(address _keeper) external onlyKeeper {
        emit KeeperUpdated(keeper, _keeper);
        keeper = _keeper;
    }

    function setSwapFee(uint256 _swapFeeBP) external onlyKeeper {
        require(_swapFeeBP <= 1000, "Fee too high"); // Max 10%
        swapFeeBP = _swapFeeBP;
        emit SwapFeeUpdated(_swapFeeBP);
    }

    function setSwapExpiry(uint256 _swapExpiry) external onlyKeeper {
        require(_swapExpiry >= 5 minutes && _swapExpiry <= 24 hours, "Invalid expiry");
        swapExpiry = _swapExpiry;
        emit SwapExpiryUpdated(_swapExpiry);
    }
}
