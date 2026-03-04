#!/bin/bash
# =============================================================================
# Diamond Claws - Base Sepolia Deployment Script
# Signs offline with cast (--chain, no --rpc-url), broadcasts via curl.
# Writes JSON payload to temp file to handle large bytecode properly.
# Uses RESULT_FILE to pass addresses back (avoids subshell stdout issues).
# =============================================================================
set -eo pipefail

export PATH="/home/gudeez/.foundry/bin:$PATH"
cd /mnt/c/Users/trevo/repos/diamond-claws/contracts

DEPLOYER=0xa88732591eC59Cd516619984DcD5083b55F10728
PK=0xb4940948fb4b86cdc4c127950b0fedce66eaec8fbd73b2cdeab0989b99bc129b
RPC=https://base-sepolia-rpc.publicnode.com
PM=0x05E73354cFDd6745C338b50BcFDfA3Aa6fA03408
CHAIN_ID=84532
DETERMINISTIC_DEPLOYER=0x4e59b44847b379578588920cA78FbF26c0B4956C
RESULT_FILE=/tmp/dclaw_deploy_result

# --- RPC helpers (all via curl) ---

rpc_call() {
    curl -s -X POST "$RPC" \
        -H "Content-Type: application/json" \
        --max-time 30 \
        --retry 3 \
        --retry-delay 2 \
        -d '{"jsonrpc":"2.0","method":"'"$1"'","params":['"$2"'],"id":1}'
}

get_nonce() {
    rpc_call "eth_getTransactionCount" '"'"$1"'","pending"' | \
        python3 -c 'import sys,json; print(int(json.load(sys.stdin)["result"],16))'
}

get_gas_price() {
    rpc_call "eth_gasPrice" "" | \
        python3 -c 'import sys,json; print(int(json.load(sys.stdin)["result"],16))'
}

send_raw_tx() {
    local PAYLOAD_FILE=$(mktemp /tmp/dclaw_tx.XXXXXX)
    python3 -c "
import json, sys
tx = sys.stdin.read().strip()
with open('$PAYLOAD_FILE', 'w') as f:
    json.dump({'jsonrpc':'2.0','method':'eth_sendRawTransaction','params':[tx],'id':1}, f)
" <<< "$1"
    local RESP=$(curl -s -X POST "$RPC" \
        -H "Content-Type: application/json" \
        --max-time 120 \
        --retry 2 \
        --retry-delay 3 \
        -d @"$PAYLOAD_FILE")
    rm -f "$PAYLOAD_FILE"
    echo "$RESP"
}

# Wait for receipt. Writes contract address to RESULT_FILE.
wait_for() {
    local TX_HASH="$1"
    local NAME="$2"
    echo "  [$NAME] Waiting for receipt..."
    for i in $(seq 1 90); do
        sleep 2
        local RESP=$(rpc_call "eth_getTransactionReceipt" '"'"$TX_HASH"'"')
        local STATUS=$(echo "$RESP" | python3 -c '
import sys,json
r = json.load(sys.stdin).get("result")
print(r["status"] if r else "")
' 2>/dev/null)
        if [ -n "$STATUS" ]; then
            if [ "$STATUS" = "0x1" ]; then
                echo "$RESP" | python3 -c '
import sys,json
r = json.load(sys.stdin)["result"]
addr = r.get("contractAddress","") or ""
print(addr)
' > "$RESULT_FILE" 2>/dev/null
                echo "  [$NAME] Confirmed!"
                return 0
            else
                echo "  [$NAME] REVERTED (status=$STATUS)"
                return 1
            fi
        fi
        if (( i % 10 == 0 )); then echo "  [$NAME] Still waiting ($i)..."; fi
    done
    echo "  [$NAME] Timed out"
    return 1
}

# Deploy contract creation tx. Writes contract address to RESULT_FILE.
deploy_contract() {
    local NAME="$1"
    local DEPLOY_DATA="$2"
    local GAS="$3"

    # Always fetch fresh nonce to avoid drift from pending txs
    NONCE=$(get_nonce "$DEPLOYER")
    echo "  [$NAME] Signing offline (nonce=$NONCE)..."
    local RAW_TX=$(cast mktx \
        --private-key $PK \
        --chain $CHAIN_ID \
        --nonce $NONCE \
        --gas-limit $GAS \
        --gas-price $GAS_PRICE \
        --create "$DEPLOY_DATA" 2>&1)

    if [[ "$RAW_TX" == Error* ]] || [[ "$RAW_TX" == error* ]]; then
        echo "  [$NAME] Sign failed: $RAW_TX"; return 1
    fi

    echo "  [$NAME] Broadcasting (${#RAW_TX} chars)..."
    local RESP=$(send_raw_tx "$RAW_TX")
    local TX_HASH=$(echo "$RESP" | python3 -c 'import sys,json; print(json.load(sys.stdin).get("result",""))' 2>/dev/null)
    local ERR=$(echo "$RESP" | python3 -c 'import sys,json; e=json.load(sys.stdin).get("error",{}); print(e.get("message",""))' 2>/dev/null)

    if [ -z "$TX_HASH" ] || [ "$TX_HASH" = "None" ] || [ "$TX_HASH" = "" ]; then
        echo "  [$NAME] Send failed: $ERR"; return 1
    fi
    echo "  [$NAME] TX: $TX_HASH"

    wait_for "$TX_HASH" "$NAME"
}

# Send a function call tx. No return value needed.
call_contract() {
    local NAME="$1"
    local TO="$2"
    local SIG="$3"
    shift 3

    # Always fetch fresh nonce
    NONCE=$(get_nonce "$DEPLOYER")
    echo "  [$NAME] Signing offline (nonce=$NONCE)..."
    local RAW_TX=$(cast mktx \
        --private-key $PK \
        --chain $CHAIN_ID \
        --nonce $NONCE \
        --gas-limit 200000 \
        --gas-price $GAS_PRICE \
        "$TO" "$SIG" "$@" 2>&1)

    if [[ "$RAW_TX" == Error* ]] || [[ "$RAW_TX" == error* ]]; then
        echo "  [$NAME] Sign failed: $RAW_TX"; return 1
    fi

    echo "  [$NAME] Broadcasting..."
    local RESP=$(send_raw_tx "$RAW_TX")
    local TX_HASH=$(echo "$RESP" | python3 -c 'import sys,json; print(json.load(sys.stdin).get("result",""))' 2>/dev/null)
    local ERR=$(echo "$RESP" | python3 -c 'import sys,json; e=json.load(sys.stdin).get("error",{}); print(e.get("message",""))' 2>/dev/null)

    if [ -z "$TX_HASH" ] || [ "$TX_HASH" = "None" ] || [ "$TX_HASH" = "" ]; then
        echo "  [$NAME] Send failed: $ERR"; return 1
    fi
    echo "  [$NAME] TX: $TX_HASH"

    wait_for "$TX_HASH" "$NAME"
}

# =============================================================================
echo "============================================"
echo "  Diamond Claws - Base Sepolia Deployment"
echo "============================================"
echo ""

echo "Fetching chain state via curl..."
NONCE=$(get_nonce "$DEPLOYER")
GAS_PRICE=$(get_gas_price)
GAS_PRICE=$((GAS_PRICE * 150 / 100))
INITIAL_NONCE=$NONCE
echo "  Deployer:   $DEPLOYER"
echo "  Nonce:      $NONCE"
echo "  Gas price:  $GAS_PRICE (with 50% buffer)"
echo ""

# === Step 1: DiamondClaws ===
echo "=== Step 1/7: Deploy DiamondClaws ==="
BYTECODE=$(forge inspect contracts/DiamondClaws.sol:DiamondClaws bytecode 2>/dev/null)
ARGS=$(cast abi-encode "constructor(address,address)" $DEPLOYER $DEPLOYER)
deploy_contract "DiamondClaws" "${BYTECODE}${ARGS#0x}" 3000000
DCLAW=$(cat "$RESULT_FILE")
echo ">>> DiamondClaws: $DCLAW"
echo ""

# === Step 2: DiamondClawsStaking ===
echo "=== Step 2/7: Deploy DiamondClawsStaking ==="
BYTECODE=$(forge inspect contracts/DiamondClawsStaking.sol:DiamondClawsStaking bytecode 2>/dev/null)
ARGS=$(cast abi-encode "constructor(address,address,address)" $DCLAW $DEPLOYER $DEPLOYER)
deploy_contract "Staking" "${BYTECODE}${ARGS#0x}" 3000000
STAKING=$(cat "$RESULT_FILE")
echo ">>> DiamondClawsStaking: $STAKING"
echo ""

# === Step 3: DCLAWSwap hook (CREATE2) ===
echo "=== Step 3/7: Deploy DCLAWSwap hook (CREATE2) ==="
HOOK_BYTECODE=$(forge inspect contracts/DCLAWSwap.sol:DCLAWSwap bytecode 2>/dev/null)
HOOK_ARGS=$(cast abi-encode "constructor(address,address)" $PM $DEPLOYER)
HOOK_INITCODE="${HOOK_BYTECODE}${HOOK_ARGS#0x}"
SALT="0000000000000000000000000000000000000000000000000000000000005013"
CREATE2_DATA="0x${SALT}${HOOK_INITCODE#0x}"

# Compute CREATE2 address: write initcode to file, hash with cast keccak
INITCODE_FILE=$(mktemp /tmp/dclaw_initcode.XXXXXX)
echo -n "${HOOK_INITCODE}" > "$INITCODE_FILE"
INIT_HASH=$(cast keccak -- "$(cat $INITCODE_FILE)" 2>/dev/null)
rm -f "$INITCODE_FILE"
# CREATE2: keccak256(0xff ++ deployer ++ salt ++ initCodeHash)
HOOK=$(cast keccak -- "$(printf '0xff%s%s%s' "${DETERMINISTIC_DEPLOYER#0x}" "$SALT" "${INIT_HASH#0x}")" 2>/dev/null)
# Take last 40 hex chars (20 bytes) as address
HOOK="0x${HOOK: -40}"
echo "  [Hook] Computed CREATE2 address: $HOOK"

# Check if hook already deployed (CREATE2 is deterministic, can't deploy twice)
HOOK_CODE=$(rpc_call "eth_getCode" '"'"$HOOK"'","latest"' | \
    python3 -c 'import sys,json; print(json.load(sys.stdin).get("result","0x"))' 2>/dev/null)

if [ "$HOOK_CODE" != "0x" ] && [ ${#HOOK_CODE} -gt 4 ]; then
    echo "  [Hook] Already deployed at $HOOK (${#HOOK_CODE} chars of code), skipping"
else
    NONCE=$(get_nonce "$DEPLOYER")
    echo "  [Hook] Signing CREATE2 offline (nonce=$NONCE)..."
    RAW_TX=$(cast mktx \
        --private-key $PK \
        --chain $CHAIN_ID \
        --nonce $NONCE \
        --gas-limit 3000000 \
        --gas-price $GAS_PRICE \
        $DETERMINISTIC_DEPLOYER "$CREATE2_DATA" 2>&1)

    if [[ "$RAW_TX" == Error* ]]; then echo "  [Hook] Sign failed: $RAW_TX"; exit 1; fi

    echo "  [Hook] Broadcasting (${#RAW_TX} chars)..."
    RESP=$(send_raw_tx "$RAW_TX")
    TX_HASH=$(echo "$RESP" | python3 -c 'import sys,json; print(json.load(sys.stdin).get("result",""))' 2>/dev/null)
    ERR=$(echo "$RESP" | python3 -c 'import sys,json; e=json.load(sys.stdin).get("error",{}); print(e.get("message",""))' 2>/dev/null)
    if [ -z "$TX_HASH" ] || [ "$TX_HASH" = "None" ] || [ "$TX_HASH" = "" ]; then
        echo "  [Hook] Send failed: $ERR"; exit 1
    fi
    echo "  [Hook] TX: $TX_HASH"
    wait_for "$TX_HASH" "Hook"
fi
echo ">>> DCLAWSwap hook: $HOOK"
echo ""

# === Step 4: DCLAWLiquidityRouter ===
echo "=== Step 4/7: Deploy DCLAWLiquidityRouter ==="
BYTECODE=$(forge inspect contracts/DCLAWLiquidityRouter.sol:DCLAWLiquidityRouter bytecode 2>/dev/null)
ARGS=$(cast abi-encode "constructor(address)" $PM)
deploy_contract "Router" "${BYTECODE}${ARGS#0x}" 3000000
ROUTER=$(cat "$RESULT_FILE")
echo ">>> DCLAWLiquidityRouter: $ROUTER"
echo ""

# === Step 5: AgentRegistry ===
echo "=== Step 5/7: Deploy AgentRegistry ==="
BYTECODE=$(forge inspect contracts/AgentRegistry.sol:AgentRegistry bytecode 2>/dev/null)
ARGS=$(cast abi-encode "constructor(address)" $DEPLOYER)
deploy_contract "Registry" "${BYTECODE}${ARGS#0x}" 1500000
REGISTRY=$(cat "$RESULT_FILE")
echo ">>> AgentRegistry: $REGISTRY"
echo ""

# === Step 6: Wire contracts ===
echo "=== Step 6/7: Wire contracts ==="
call_contract "setStakingContract" "$DCLAW" "setStakingContract(address)" "$STAKING"
call_contract "setAgentWallet" "$REGISTRY" "setAgentWallet(address)" "$DEPLOYER"
call_contract "taxExclude(hook)" "$DCLAW" "setTaxExcluded(address,bool)" "$HOOK" true
call_contract "taxExclude(router)" "$DCLAW" "setTaxExcluded(address,bool)" "$ROUTER" true
echo ""

# === Step 7: Initialize pool ===
echo "=== Step 7/7: Initialize pool ==="
POOL_KEY="(0x0000000000000000000000000000000000000000,$DCLAW,3000,60,$HOOK)"
SQRT_PRICE="79228162514264337593543950336000"

NONCE=$(get_nonce "$DEPLOYER")
echo "  [Pool] Signing offline (nonce=$NONCE)..."
RAW_TX=$(cast mktx \
    --private-key $PK \
    --chain $CHAIN_ID \
    --nonce $NONCE \
    --gas-limit 500000 \
    --gas-price $GAS_PRICE \
    "$PM" "initialize((address,address,uint24,int24,address),uint160)" "$POOL_KEY" "$SQRT_PRICE" 2>&1)

if [[ "$RAW_TX" == Error* ]]; then echo "  [Pool] Sign failed: $RAW_TX"; exit 1; fi

echo "  [Pool] Broadcasting..."
RESP=$(send_raw_tx "$RAW_TX")
TX_HASH=$(echo "$RESP" | python3 -c 'import sys,json; print(json.load(sys.stdin).get("result",""))' 2>/dev/null)
ERR=$(echo "$RESP" | python3 -c 'import sys,json; e=json.load(sys.stdin).get("error",{}); print(e.get("message",""))' 2>/dev/null)
if [ -z "$TX_HASH" ] || [ "$TX_HASH" = "None" ] || [ "$TX_HASH" = "" ]; then
    echo "  [Pool] Send failed: $ERR"; exit 1
fi
echo "  [Pool] TX: $TX_HASH"
wait_for "$TX_HASH" "Pool"
echo "  Pool initialized!"
echo ""

# =============================================================================
echo "=========================================="
echo "  DEPLOYMENT SUMMARY (Base Sepolia)"
echo "=========================================="
echo "  PoolManager:          $PM"
echo "  DiamondClaws (DCLAW): $DCLAW"
echo "  DiamondClawsStaking:  $STAKING"
echo "  DCLAWSwap Hook:       $HOOK"
echo "  DCLAWLiquidityRouter: $ROUTER"
echo "  AgentRegistry:        $REGISTRY"
echo "=========================================="
echo ""
echo "Done! $((NONCE - INITIAL_NONCE)) transactions sent."

rm -f "$RESULT_FILE"
