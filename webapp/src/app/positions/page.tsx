'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import { motion } from 'framer-motion';
import {
  Wallet,
  Plus,
  Minus,
  Droplets,
  ArrowLeft,
  Loader2,
  X,
  ChevronDown,
  Info,
} from 'lucide-react';

// --- Shared types & constants (mirrors page.tsx) ---

interface EIP6963ProviderInfo {
  uuid: string;
  name: string;
  icon: string;
  rdns: string;
}

interface EIP1193Provider {
  request(args: { method: string; params?: unknown[] }): Promise<unknown>;
  on?(event: string, handler: (...args: unknown[]) => void): void;
  removeListener?(event: string, handler: (...args: unknown[]) => void): void;
}

interface EIP6963ProviderDetail {
  info: EIP6963ProviderInfo;
  provider: EIP1193Provider;
}

interface EIP6963AnnounceProviderEvent extends Event {
  detail: EIP6963ProviderDetail;
}

const CONTRACTS = {
  DCLAW: '0x778f108fbf1faa1ea735cc146f18c5a0b49cb47c',
  POOL_MANAGER: '0x498581fF718922c3f8e6A244956aF099B2652b2b',
  HOOK: '0x159fb90528f2a41f8603822bf7c0d7f664c60088',
  LIQUIDITY_ROUTER: '0xa72196e90412ef1c9de7bb69e0d31287870afeeb',
  CHAIN_ID: 8453,
};

const BASE_RPC = 'https://base-rpc.publicnode.com';
const FAUCET_ACCOUNT = '0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266';

// Pool constants
const POOL_FEE = 3000;
const TICK_SPACING = 60;
// Full-range ticks aligned to tickSpacing=60
const MIN_TICK = -887220;
const MAX_TICK = 887220;

// --- ABI selectors ---
const SELECTORS: Record<string, string> = {
  'balanceOf(address)': '0x70a08231',
  'approve(address,uint256)': '0x095ea7b3',
  // DCLAWLiquidityRouter
  'addLiquidity((address,address,uint24,int24,address),int24,int24,int256)': '0x',
  'removeLiquidity((address,address,uint24,int24,address),int24,int24,int256)': '0x',
  'getPositionCount(address)': '0x',
  'getPosition(address,uint256)': '0x',
};

// --- Helpers ---

function decodeUint256(hex: string): bigint {
  if (hex === '0x' || !hex) return BigInt(0);
  return BigInt(hex);
}

function formatEther(wei: bigint): string {
  const eth = Number(wei) / 1e18;
  if (eth === 0) return '0';
  if (eth < 0.0001) return '<0.0001';
  if (eth < 1) return eth.toFixed(4);
  if (eth < 1000) return eth.toFixed(2);
  return eth.toLocaleString(undefined, { maximumFractionDigits: 2 });
}

function parseEther(eth: string): string {
  const wei = BigInt(Math.floor(parseFloat(eth) * 1e18));
  return '0x' + wei.toString(16);
}

function tickToPrice(tick: number): string {
  // price = 1.0001^tick
  const price = Math.pow(1.0001, tick);
  if (price < 0.0001) return '<0.0001';
  if (price < 1) return price.toFixed(6);
  if (price < 1000) return price.toFixed(2);
  return price.toLocaleString(undefined, { maximumFractionDigits: 0 });
}

// Encode a uint256 as 32-byte hex
function encodeUint256(val: bigint): string {
  return val.toString(16).padStart(64, '0');
}

// Encode int256 (two's complement)
function encodeInt256(val: bigint): string {
  if (val >= BigInt(0)) {
    return val.toString(16).padStart(64, '0');
  }
  // Two's complement for negative
  const twos = (BigInt(1) << BigInt(256)) + val;
  return twos.toString(16).padStart(64, '0');
}

// Encode int24 as int256
function encodeInt24AsInt256(val: number): string {
  return encodeInt256(BigInt(val));
}

// Encode address as 32-byte
function encodeAddress(addr: string): string {
  return addr.slice(2).toLowerCase().padStart(64, '0');
}

// Build PoolKey tuple encoding (5 fields: currency0, currency1, fee, tickSpacing, hooks)
function encodePoolKey(): string {
  // ETH = address(0) is always < any contract address
  const currency0 = encodeAddress('0x0000000000000000000000000000000000000000');
  const currency1 = encodeAddress(CONTRACTS.DCLAW);
  const fee = encodeUint256(BigInt(POOL_FEE));
  const tickSpacing = encodeInt24AsInt256(TICK_SPACING);
  const hooks = encodeAddress(CONTRACTS.HOOK);
  return currency0 + currency1 + fee + tickSpacing + hooks;
}

// --- Position interface ---
interface Position {
  index: number;
  tickLower: number;
  tickUpper: number;
  liquidity: bigint;
}

// Range presets
type RangePreset = 'full' | 'wide' | 'narrow' | 'custom';

const RANGE_PRESETS: { key: RangePreset; label: string; description: string }[] = [
  { key: 'full', label: 'Full Range', description: 'Covers entire price range' },
  { key: 'wide', label: 'Wide', description: '0.5x - 2x current price' },
  { key: 'narrow', label: 'Narrow', description: '0.9x - 1.1x current price' },
  { key: 'custom', label: 'Custom', description: 'Set your own ticks' },
];

export default function PositionsPage() {
  // Wallet state
  const [isConnected, setIsConnected] = useState(false);
  const [address, setAddress] = useState('');
  const [ethBalance, setEthBalance] = useState('0');
  const [dclawBalance, setDclawBalance] = useState('0');

  // Positions state
  const [positions, setPositions] = useState<Position[]>([]);
  const [isLoadingPositions, setIsLoadingPositions] = useState(false);

  // Add liquidity state
  const [showAddModal, setShowAddModal] = useState(false);
  const [rangePreset, setRangePreset] = useState<RangePreset>('full');
  const [customTickLower, setCustomTickLower] = useState(MIN_TICK.toString());
  const [customTickUpper, setCustomTickUpper] = useState(MAX_TICK.toString());
  const [ethAmount, setEthAmount] = useState('');
  const [dclawAmount, setDclawAmount] = useState('');
  const [isAdding, setIsAdding] = useState(false);

  // Remove liquidity state
  const [removingIndex, setRemovingIndex] = useState<number | null>(null);

  // General
  const [status, setStatus] = useState('');

  // EIP-6963 wallet discovery
  const [discoveredWallets, setDiscoveredWallets] = useState<EIP6963ProviderDetail[]>([]);
  const [selectedProvider, setSelectedProvider] = useState<EIP1193Provider | null>(null);
  const [selectedWalletName, setSelectedWalletName] = useState('');
  const [showWalletPicker, setShowWalletPicker] = useState(false);
  const walletsRef = useRef<EIP6963ProviderDetail[]>([]);

  // EIP-6963 discovery
  useEffect(() => {
    const handleAnnounce = (event: Event) => {
      const e = event as EIP6963AnnounceProviderEvent;
      const detail = e.detail;
      if (!walletsRef.current.some(w => w.info.uuid === detail.info.uuid)) {
        walletsRef.current = [...walletsRef.current, detail];
        setDiscoveredWallets([...walletsRef.current]);
      }
    };

    window.addEventListener('eip6963:announceProvider', handleAnnounce);
    window.dispatchEvent(new Event('eip6963:requestProvider'));

    const fallbackTimer = setTimeout(() => {
      const eth = (window as unknown as { ethereum?: EIP1193Provider }).ethereum;
      if (walletsRef.current.length === 0 && eth) {
        const fallbackProvider: EIP6963ProviderDetail = {
          info: { uuid: 'legacy', name: 'Browser Wallet', icon: '', rdns: 'legacy' },
          provider: eth,
        };
        walletsRef.current = [fallbackProvider];
        setDiscoveredWallets([fallbackProvider]);
      }
    }, 500);

    return () => {
      window.removeEventListener('eip6963:announceProvider', handleAnnounce);
      clearTimeout(fallbackTimer);
    };
  }, []);

  const rpcCall = useCallback(async (method: string, params: unknown[]) => {
    if (!selectedProvider) return null;
    return selectedProvider.request({ method, params });
  }, [selectedProvider]);

  const readContract = useCallback(async (to: string, data: string) => {
    return rpcCall('eth_call', [{ to, data }, 'latest']);
  }, [rpcCall]);

  // Direct RPC call to Anvil (bypasses wallet)
  const anvilRpc = useCallback(async (method: string, params: unknown[]) => {
    const res = await fetch(BASE_RPC, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', method, params, id: Date.now() }),
    });
    const data = await res.json();
    if (data.error) throw new Error(data.error.message);
    return data.result;
  }, []);

  const waitForReceipt = useCallback(async (txHash: string, maxAttempts = 30): Promise<boolean> => {
    for (let i = 0; i < maxAttempts; i++) {
      await new Promise(r => setTimeout(r, 1000));
      const receipt = await rpcCall('eth_getTransactionReceipt', [txHash]);
      if (receipt) return (receipt as { status: string }).status === '0x1';
    }
    return false;
  }, [rpcCall]);

  // Fetch balances
  const fetchBalances = useCallback(async (userAddress: string) => {
    try {
      const ethBal = await rpcCall('eth_getBalance', [userAddress, 'latest']);
      if (ethBal) setEthBalance(formatEther(BigInt(ethBal as string)));

      const dclawBal = await readContract(
        CONTRACTS.DCLAW,
        SELECTORS['balanceOf(address)'] + encodeAddress(userAddress)
      );
      if (dclawBal) setDclawBalance(formatEther(decodeUint256(dclawBal as string)));
    } catch (error) {
      console.error('Error fetching balances:', error);
    }
  }, [rpcCall, readContract]);

  // Fetch positions from the liquidity router
  const fetchPositions = useCallback(async (userAddress: string) => {
    if (CONTRACTS.LIQUIDITY_ROUTER === '0x0000000000000000000000000000000000000000') {
      return; // Router not deployed yet
    }

    setIsLoadingPositions(true);
    try {
      // getPositionCount(address) = 0x0234b445
      const countData = '0x0234b445' + encodeAddress(userAddress);
      const countResult = await readContract(CONTRACTS.LIQUIDITY_ROUTER, countData);
      const count = countResult ? Number(decodeUint256(countResult as string)) : 0;

      const fetched: Position[] = [];
      for (let i = 0; i < count; i++) {
        // getPosition(address, uint256) = 0x3adbb5af
        const posData = '0x3adbb5af' + encodeAddress(userAddress) + encodeUint256(BigInt(i));
        const posResult = await readContract(CONTRACTS.LIQUIDITY_ROUTER, posData);
        if (posResult) {
          const hex = (posResult as string).slice(2);
          const tickLower = Number(BigInt('0x' + hex.slice(0, 64)) > BigInt('0x7fffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff')
            ? BigInt('0x' + hex.slice(0, 64)) - (BigInt(1) << BigInt(256))
            : BigInt('0x' + hex.slice(0, 64)));
          const tickUpper = Number(BigInt('0x' + hex.slice(64, 128)) > BigInt('0x7fffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff')
            ? BigInt('0x' + hex.slice(64, 128)) - (BigInt(1) << BigInt(256))
            : BigInt('0x' + hex.slice(64, 128)));
          const liquidity = BigInt('0x' + hex.slice(128, 192));
          if (liquidity > BigInt(0)) {
            fetched.push({ index: i, tickLower, tickUpper, liquidity });
          }
        }
      }
      setPositions(fetched);
    } catch (error) {
      console.error('Error fetching positions:', error);
    } finally {
      setIsLoadingPositions(false);
    }
  }, [readContract]);

  // Select and connect wallet
  const selectAndConnect = useCallback(async (wallet: EIP6963ProviderDetail) => {
    setSelectedProvider(wallet.provider);
    setSelectedWalletName(wallet.info.name);
    setShowWalletPicker(false);
    try {
      const accounts = await wallet.provider.request({ method: 'eth_requestAccounts' }) as string[];
      setAddress(accounts[0]);
      setIsConnected(true);
      // Fetch data with the provider directly
      const ethBal = await wallet.provider.request({ method: 'eth_getBalance', params: [accounts[0], 'latest'] });
      if (ethBal) setEthBalance(formatEther(BigInt(ethBal as string)));
      const dclawBal = await wallet.provider.request({
        method: 'eth_call',
        params: [{ to: CONTRACTS.DCLAW, data: SELECTORS['balanceOf(address)'] + encodeAddress(accounts[0]) }, 'latest']
      });
      if (dclawBal) setDclawBalance(formatEther(decodeUint256(dclawBal as string)));
    } catch (error) {
      console.error('Failed to connect:', error);
      setStatus('Failed to connect wallet');
      setSelectedProvider(null);
      setSelectedWalletName('');
    }
  }, []);

  const connectWallet = useCallback(async () => {
    if (isConnected) return;
    if (discoveredWallets.length === 0) {
      setStatus('No wallet detected. Install a wallet extension.');
      return;
    }
    if (discoveredWallets.length === 1) {
      await selectAndConnect(discoveredWallets[0]);
    } else {
      setShowWalletPicker(true);
    }
  }, [discoveredWallets, selectAndConnect, isConnected]);

  // Fetch positions when connected
  useEffect(() => {
    if (isConnected && address) {
      fetchPositions(address);
    }
  }, [isConnected, address, fetchPositions]);

  // Get tick range from preset
  const getTickRange = (): [number, number] => {
    switch (rangePreset) {
      case 'full':
        return [MIN_TICK, MAX_TICK];
      case 'wide': {
        // ~0.5x to 2x: tick offset ≈ ±6932 (ln(2)/ln(1.0001)), aligned to spacing
        const offset = Math.ceil(6932 / TICK_SPACING) * TICK_SPACING;
        return [-offset, offset];
      }
      case 'narrow': {
        // ~0.9x to 1.1x: tick offset ≈ ±953, aligned to spacing
        const offset = Math.ceil(953 / TICK_SPACING) * TICK_SPACING;
        return [-offset, offset];
      }
      case 'custom':
        return [
          Math.round(parseInt(customTickLower) / TICK_SPACING) * TICK_SPACING,
          Math.round(parseInt(customTickUpper) / TICK_SPACING) * TICK_SPACING,
        ];
    }
  };

  // Add liquidity
  const addLiquidity = async () => {
    if (!isConnected) return;
    if (CONTRACTS.LIQUIDITY_ROUTER === '0x0000000000000000000000000000000000000000') {
      setStatus('Liquidity router not deployed. Run deploy script first.');
      return;
    }

    const ethAmt = parseFloat(ethAmount || '0');
    const dclawAmt = parseFloat(dclawAmount || '0');
    if (ethAmt <= 0 && dclawAmt <= 0) {
      setStatus('Enter an amount');
      return;
    }

    setIsAdding(true);
    const [tickLower, tickUpper] = getTickRange();

    try {
      // Step 1: Approve DCLAW spend on the liquidity router
      if (dclawAmt > 0) {
        setStatus('Approving DCLAW spend... confirm in wallet');
        const approveData = SELECTORS['approve(address,uint256)']
          + encodeAddress(CONTRACTS.LIQUIDITY_ROUTER)
          + encodeUint256(BigInt(parseEther(dclawAmount)));
        const approveTx = await rpcCall('eth_sendTransaction', [{
          from: address,
          to: CONTRACTS.DCLAW,
          data: approveData,
        }]) as string;
        if (!(await waitForReceipt(approveTx))) {
          setStatus('Approval failed');
          setIsAdding(false);
          return;
        }
      }

      // Step 2: Call addLiquidity on the router
      // We use a simple liquidity amount based on ETH input.
      // In a real app, you'd use a quoter. For local dev, use a reasonable default.
      // liquidityDelta = ethAmount * 1e18 (scaled)
      const liquidityDelta = ethAmt > 0
        ? BigInt(Math.floor(ethAmt * 1e15)) * BigInt(1000) // scale
        : BigInt(Math.floor(dclawAmt * 1e12)) * BigInt(1000);

      setStatus('Adding liquidity... confirm in wallet');

      // ABI: addLiquidity(PoolKey,int24,int24,int256)
      // selector for addLiquidity((address,address,uint24,int24,address),int24,int24,int256)
      const selector = '0xe2e6fcbe';
      // PoolKey is a tuple encoded inline (not as dynamic offset since it's a static tuple)
      const poolKeyEncoded = encodePoolKey();
      const tickLowerEncoded = encodeInt24AsInt256(tickLower);
      const tickUpperEncoded = encodeInt24AsInt256(tickUpper);
      const liquidityEncoded = encodeInt256(liquidityDelta);

      const calldata = selector + poolKeyEncoded + tickLowerEncoded + tickUpperEncoded + liquidityEncoded;

      const ethValue = ethAmt > 0 ? parseEther(ethAmount) : '0x0';

      const txHash = await rpcCall('eth_sendTransaction', [{
        from: address,
        to: CONTRACTS.LIQUIDITY_ROUTER,
        data: calldata,
        value: ethValue,
      }]) as string;

      if (await waitForReceipt(txHash)) {
        setStatus('Liquidity added successfully!');
        setShowAddModal(false);
        setEthAmount('');
        setDclawAmount('');
        await fetchBalances(address);
        await fetchPositions(address);
      } else {
        setStatus('Add liquidity failed - transaction reverted');
      }
    } catch (error: unknown) {
      console.error('Add liquidity error:', error);
      const msg = error instanceof Error ? error.message : 'Unknown error';
      if (msg.includes('User denied') || msg.includes('rejected')) {
        setStatus('Transaction rejected');
      } else {
        setStatus('Add liquidity failed: ' + msg.slice(0, 60));
      }
    } finally {
      setIsAdding(false);
    }
  };

  // Remove liquidity
  const removeLiquidity = async (pos: Position) => {
    if (!isConnected) return;
    setRemovingIndex(pos.index);

    try {
      setStatus('Removing liquidity... confirm in wallet');

      // selector for removeLiquidity((address,address,uint24,int24,address),int24,int24,int256)
      const selector = '0x0d66ec6a';
      const poolKeyEncoded = encodePoolKey();
      const tickLowerEncoded = encodeInt24AsInt256(pos.tickLower);
      const tickUpperEncoded = encodeInt24AsInt256(pos.tickUpper);
      // Negative liquidity delta for removal
      const liquidityEncoded = encodeInt256(-BigInt(pos.liquidity));

      const calldata = selector + poolKeyEncoded + tickLowerEncoded + tickUpperEncoded + liquidityEncoded;

      const txHash = await rpcCall('eth_sendTransaction', [{
        from: address,
        to: CONTRACTS.LIQUIDITY_ROUTER,
        data: calldata,
      }]) as string;

      if (await waitForReceipt(txHash)) {
        setStatus('Liquidity removed successfully!');
        await fetchBalances(address);
        await fetchPositions(address);
      } else {
        setStatus('Remove liquidity failed - transaction reverted');
      }
    } catch (error: unknown) {
      console.error('Remove liquidity error:', error);
      const msg = error instanceof Error ? error.message : 'Unknown error';
      if (msg.includes('User denied') || msg.includes('rejected')) {
        setStatus('Transaction rejected');
      } else {
        setStatus('Remove liquidity failed: ' + msg.slice(0, 60));
      }
    } finally {
      setRemovingIndex(null);
    }
  };

  // Auto-clear status
  useEffect(() => {
    if (status && !isAdding && removingIndex === null) {
      const timer = setTimeout(() => setStatus(''), 5000);
      return () => clearTimeout(timer);
    }
  }, [status, isAdding, removingIndex]);

  const [tickLowerDisplay, tickUpperDisplay] = getTickRange();

  return (
    <div className="min-h-screen bg-gradient-to-b from-gray-950 via-gray-900 to-gray-950">
      {/* Header */}
      <header className="border-b border-yellow-500/20 bg-black/50 backdrop-blur-xl sticky top-0 z-50">
        <div className="max-w-7xl mx-auto px-4 py-4 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <img src="/diamondclaw2.png" alt="Diamond Claws" className="w-12 h-12 rounded-xl animate-glow" />
            <div>
              <h1 className="text-2xl font-bold text-gradient">Diamond Claws</h1>
              <p className="text-xs text-yellow-500/70">DCLAW &bull; These Claws Don&apos;t Sell</p>
            </div>
          </div>

          <div className="flex items-center gap-4">
            <nav className="hidden md:flex items-center gap-1 text-sm">
              <a href="/" className="px-3 py-1.5 text-gray-400 hover:text-yellow-400 hover:bg-yellow-500/10 rounded-lg transition-colors">Home</a>
              <span className="px-3 py-1.5 text-yellow-400 font-medium bg-yellow-500/10 rounded-lg">Positions</span>
              <a href="/crowdfund" className="px-3 py-1.5 text-gray-400 hover:text-yellow-400 hover:bg-yellow-500/10 rounded-lg transition-colors">Crowdfund</a>
            </nav>
            {isConnected && (
              <div className="hidden md:flex items-center gap-3 text-sm">
                <span className="text-gray-400">{ethBalance} ETH</span>
                <span className="text-yellow-400 font-medium">{dclawBalance} DCLAW</span>
              </div>
            )}
            <button
              onClick={connectWallet}
              className="flex items-center gap-2 px-6 py-3 bg-yellow-500 hover:bg-yellow-400 text-black font-bold rounded-xl transition-all hover:scale-105"
            >
              <Wallet size={20} />
              {isConnected ? (
                <span title={selectedWalletName}>{address.slice(0, 6)}...{address.slice(-4)}</span>
              ) : (
                <span>Connect Wallet</span>
              )}
            </button>
          </div>
        </div>
      </header>

      <main className="max-w-4xl mx-auto px-4 py-8">
        {/* Page Title */}
        <div className="flex items-center justify-between mb-8">
          <div>
            <div className="flex items-center gap-3 mb-2">
              <a href="/" className="text-gray-400 hover:text-yellow-400 transition-colors">
                <ArrowLeft size={20} />
              </a>
              <h2 className="text-3xl font-bold text-white">Liquidity Positions</h2>
            </div>
            <p className="text-gray-400 ml-8">Provide liquidity to the DCLAW/ETH pool and earn fees</p>
          </div>
          <button
            onClick={() => setShowAddModal(true)}
            disabled={!isConnected}
            className="flex items-center gap-2 px-6 py-3 bg-yellow-500 hover:bg-yellow-400 disabled:bg-gray-700 text-black font-bold rounded-xl transition-all hover:scale-105"
          >
            <Plus size={20} />
            New Position
          </button>
        </div>

        {/* Pool Info Card */}
        <motion.div
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          className="card-gradient rounded-2xl p-6 mb-8"
        >
          <div className="flex items-center gap-4 mb-4">
            <div className="flex -space-x-2">
              <div className="w-10 h-10 rounded-full bg-blue-500 flex items-center justify-center text-sm font-bold text-white border-2 border-gray-900 z-10">E</div>
              <img src="/diamondclaw2.png" alt="DCLAW" className="w-10 h-10 rounded-full border-2 border-gray-900" />
            </div>
            <div>
              <h3 className="text-xl font-bold text-white">ETH / DCLAW</h3>
              <span className="text-xs px-2 py-0.5 bg-yellow-500/20 text-yellow-400 rounded-full">0.3% fee</span>
            </div>
          </div>
          <div className="grid grid-cols-3 gap-4">
            <div className="bg-black/30 rounded-xl p-4">
              <p className="text-xs text-gray-400 mb-1">Pool</p>
              <p className="text-lg font-bold text-white">Uniswap v4</p>
            </div>
            <div className="bg-black/30 rounded-xl p-4">
              <p className="text-xs text-gray-400 mb-1">Tick Spacing</p>
              <p className="text-lg font-bold text-white">{TICK_SPACING}</p>
            </div>
            <div className="bg-black/30 rounded-xl p-4">
              <p className="text-xs text-gray-400 mb-1">Hook</p>
              <p className="text-lg font-bold text-yellow-400 truncate" title={CONTRACTS.HOOK}>DCLAWSwap</p>
            </div>
          </div>
        </motion.div>

        {/* Positions List */}
        <div className="space-y-4">
          <h3 className="text-lg font-bold text-white">Your Positions ({positions.length})</h3>

          {!isConnected ? (
            <div className="card-gradient rounded-2xl p-12 text-center">
              <Wallet className="mx-auto mb-4 text-gray-600" size={48} />
              <p className="text-gray-400 text-lg mb-2">Connect your wallet</p>
              <p className="text-gray-500 text-sm">Connect to view your liquidity positions</p>
            </div>
          ) : isLoadingPositions ? (
            <div className="card-gradient rounded-2xl p-12 text-center">
              <Loader2 className="mx-auto mb-4 text-yellow-400 animate-spin" size={48} />
              <p className="text-gray-400">Loading positions...</p>
            </div>
          ) : positions.length === 0 ? (
            <div className="card-gradient rounded-2xl p-12 text-center">
              <Droplets className="mx-auto mb-4 text-gray-600" size={48} />
              <p className="text-gray-400 text-lg mb-2">No active positions</p>
              <p className="text-gray-500 text-sm mb-6">Add liquidity to the DCLAW/ETH pool to start earning fees</p>
              <button
                onClick={() => setShowAddModal(true)}
                className="inline-flex items-center gap-2 px-6 py-3 bg-yellow-500 hover:bg-yellow-400 text-black font-bold rounded-xl transition-all"
              >
                <Plus size={20} />
                New Position
              </button>
            </div>
          ) : (
            positions.map((pos) => (
              <motion.div
                key={pos.index}
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                className="card-gradient rounded-2xl p-6"
              >
                <div className="flex items-center justify-between mb-4">
                  <div className="flex items-center gap-3">
                    <div className="flex -space-x-1">
                      <div className="w-8 h-8 rounded-full bg-blue-500 flex items-center justify-center text-xs font-bold text-white border-2 border-gray-900 z-10">E</div>
                      <img src="/diamondclaw2.png" alt="DCLAW" className="w-8 h-8 rounded-full border-2 border-gray-900" />
                    </div>
                    <div>
                      <p className="font-bold text-white">ETH / DCLAW</p>
                      <span className="text-xs text-yellow-400">0.3% fee</span>
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className={`text-xs px-2 py-1 rounded-full ${
                      pos.tickLower === MIN_TICK && pos.tickUpper === MAX_TICK
                        ? 'bg-green-500/20 text-green-400'
                        : 'bg-blue-500/20 text-blue-400'
                    }`}>
                      {pos.tickLower === MIN_TICK && pos.tickUpper === MAX_TICK ? 'Full Range' : 'Custom Range'}
                    </span>
                  </div>
                </div>

                <div className="grid grid-cols-3 gap-4 mb-4">
                  <div className="bg-black/30 rounded-lg p-3">
                    <p className="text-xs text-gray-400">Min Price</p>
                    <p className="text-sm font-bold text-white">
                      {pos.tickLower === MIN_TICK ? '0' : tickToPrice(pos.tickLower)}
                    </p>
                    <p className="text-xs text-gray-500">ETH per DCLAW</p>
                  </div>
                  <div className="bg-black/30 rounded-lg p-3 text-center">
                    <p className="text-xs text-gray-400">Liquidity</p>
                    <p className="text-sm font-bold text-yellow-400">{formatEther(pos.liquidity)}</p>
                  </div>
                  <div className="bg-black/30 rounded-lg p-3 text-right">
                    <p className="text-xs text-gray-400">Max Price</p>
                    <p className="text-sm font-bold text-white">
                      {pos.tickUpper === MAX_TICK ? '\u221E' : tickToPrice(pos.tickUpper)}
                    </p>
                    <p className="text-xs text-gray-500">ETH per DCLAW</p>
                  </div>
                </div>

                <button
                  onClick={() => removeLiquidity(pos)}
                  disabled={removingIndex === pos.index}
                  className="w-full py-3 bg-red-500/20 hover:bg-red-500/30 disabled:opacity-50 text-red-400 font-medium rounded-xl transition-colors flex items-center justify-center gap-2"
                >
                  {removingIndex === pos.index ? (
                    <><Loader2 className="animate-spin" size={16} /> Removing...</>
                  ) : (
                    <><Minus size={16} /> Remove Liquidity</>
                  )}
                </button>
              </motion.div>
            ))
          )}
        </div>
      </main>

      {/* Add Liquidity Modal */}
      {showAddModal && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/60 backdrop-blur-sm" onClick={() => setShowAddModal(false)}>
          <motion.div
            initial={{ opacity: 0, scale: 0.95 }}
            animate={{ opacity: 1, scale: 1 }}
            className="bg-gray-900 border border-yellow-500/30 rounded-2xl p-6 w-full max-w-md mx-4 shadow-2xl max-h-[90vh] overflow-y-auto"
            onClick={e => e.stopPropagation()}
          >
            <div className="flex items-center justify-between mb-6">
              <h3 className="text-xl font-bold text-white">Add Liquidity</h3>
              <button onClick={() => setShowAddModal(false)} className="text-gray-400 hover:text-white">
                <X size={20} />
              </button>
            </div>

            {/* Pool Pair */}
            <div className="flex items-center gap-3 p-3 bg-black/40 rounded-xl mb-6 border border-yellow-500/10">
              <div className="flex -space-x-1">
                <div className="w-8 h-8 rounded-full bg-blue-500 flex items-center justify-center text-xs font-bold text-white border-2 border-gray-900 z-10">E</div>
                <img src="/diamondclaw2.png" alt="DCLAW" className="w-8 h-8 rounded-full border-2 border-gray-900" />
              </div>
              <div>
                <p className="font-bold text-white text-sm">ETH / DCLAW</p>
                <p className="text-xs text-gray-400">0.3% fee tier</p>
              </div>
            </div>

            {/* Range Selection */}
            <div className="mb-6">
              <label className="block text-sm font-medium text-gray-300 mb-3">Price Range</label>
              <div className="grid grid-cols-4 gap-2 mb-4">
                {RANGE_PRESETS.map((preset) => (
                  <button
                    key={preset.key}
                    onClick={() => setRangePreset(preset.key)}
                    className={`py-2 px-3 rounded-lg text-xs font-medium transition-colors ${
                      rangePreset === preset.key
                        ? 'bg-yellow-500/20 text-yellow-400 border border-yellow-500/40'
                        : 'bg-black/40 text-gray-400 border border-gray-700 hover:border-yellow-500/30'
                    }`}
                  >
                    {preset.label}
                  </button>
                ))}
              </div>

              {rangePreset === 'custom' && (
                <div className="grid grid-cols-2 gap-3 mb-3">
                  <div>
                    <label className="block text-xs text-gray-400 mb-1">Min Tick</label>
                    <input
                      type="number"
                      value={customTickLower}
                      onChange={(e) => setCustomTickLower(e.target.value)}
                      step={TICK_SPACING}
                      className="w-full px-3 py-2 bg-black/50 border border-gray-700 rounded-lg text-white text-sm focus:outline-none focus:border-yellow-500"
                    />
                  </div>
                  <div>
                    <label className="block text-xs text-gray-400 mb-1">Max Tick</label>
                    <input
                      type="number"
                      value={customTickUpper}
                      onChange={(e) => setCustomTickUpper(e.target.value)}
                      step={TICK_SPACING}
                      className="w-full px-3 py-2 bg-black/50 border border-gray-700 rounded-lg text-white text-sm focus:outline-none focus:border-yellow-500"
                    />
                  </div>
                </div>
              )}

              <div className="flex items-center gap-2 p-3 bg-blue-500/10 rounded-lg border border-blue-500/20">
                <Info size={14} className="text-blue-400 shrink-0" />
                <p className="text-xs text-blue-300">
                  {rangePreset === 'full'
                    ? 'Full range covers all prices. Lower capital efficiency but no risk of going out of range.'
                    : rangePreset === 'wide'
                    ? 'Wide range covers 0.5x to 2x current price. Good balance of efficiency and coverage.'
                    : rangePreset === 'narrow'
                    ? 'Narrow range covers 0.9x to 1.1x. Higher fees but may go out of range.'
                    : `Custom ticks: ${tickLowerDisplay} to ${tickUpperDisplay} (aligned to spacing ${TICK_SPACING})`
                  }
                </p>
              </div>
            </div>

            {/* Amount Inputs */}
            <div className="space-y-3 mb-6">
              <div>
                <div className="flex items-center justify-between mb-1">
                  <label className="text-sm text-gray-300">ETH Amount</label>
                  {isConnected && (
                    <button
                      onClick={() => {
                        const max = Math.max(0, parseFloat(ethBalance) - 0.01);
                        setEthAmount(max > 0 ? max.toString() : '');
                      }}
                      className="text-xs text-yellow-400 hover:text-yellow-300"
                    >
                      Balance: {ethBalance}
                    </button>
                  )}
                </div>
                <div className="flex items-center gap-2">
                  <input
                    type="number"
                    value={ethAmount}
                    onChange={(e) => setEthAmount(e.target.value)}
                    placeholder="0.0"
                    min="0"
                    step="0.01"
                    className="flex-1 px-4 py-3 bg-black/50 border border-gray-700 rounded-xl text-white text-lg focus:outline-none focus:border-yellow-500 [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
                  />
                  <div className="flex items-center gap-2 px-3 py-3 bg-gray-800 rounded-xl">
                    <div className="w-6 h-6 rounded-full bg-blue-500 flex items-center justify-center text-xs font-bold text-white">E</div>
                    <span className="font-bold text-white text-sm">ETH</span>
                  </div>
                </div>
              </div>

              <div>
                <div className="flex items-center justify-between mb-1">
                  <label className="text-sm text-gray-300">DCLAW Amount</label>
                  {isConnected && (
                    <button
                      onClick={() => setDclawAmount(dclawBalance.replace(/,/g, ''))}
                      className="text-xs text-yellow-400 hover:text-yellow-300"
                    >
                      Balance: {dclawBalance}
                    </button>
                  )}
                </div>
                <div className="flex items-center gap-2">
                  <input
                    type="number"
                    value={dclawAmount}
                    onChange={(e) => setDclawAmount(e.target.value)}
                    placeholder="0.0"
                    min="0"
                    step="1"
                    className="flex-1 px-4 py-3 bg-black/50 border border-gray-700 rounded-xl text-white text-lg focus:outline-none focus:border-yellow-500 [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
                  />
                  <div className="flex items-center gap-2 px-3 py-3 bg-gray-800 rounded-xl">
                    <img src="/diamondclaw2.png" alt="DCLAW" className="w-6 h-6 rounded-full" />
                    <span className="font-bold text-yellow-400 text-sm">DCLAW</span>
                  </div>
                </div>
              </div>
            </div>

            {/* Submit */}
            <button
              onClick={addLiquidity}
              disabled={isAdding || (!ethAmount && !dclawAmount) || (parseFloat(ethAmount || '0') <= 0 && parseFloat(dclawAmount || '0') <= 0)}
              className="w-full py-4 bg-yellow-500 hover:bg-yellow-400 disabled:bg-gray-700 disabled:cursor-not-allowed text-black font-bold rounded-xl transition-all flex items-center justify-center gap-2 text-lg"
            >
              {isAdding ? (
                <><Loader2 className="animate-spin" size={20} /> Adding Liquidity...</>
              ) : (
                <><Droplets size={20} /> Add Liquidity</>
              )}
            </button>
          </motion.div>
        </div>
      )}

      {/* Wallet Picker Modal */}
      {showWalletPicker && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/60 backdrop-blur-sm" onClick={() => setShowWalletPicker(false)}>
          <motion.div
            initial={{ opacity: 0, scale: 0.95 }}
            animate={{ opacity: 1, scale: 1 }}
            className="bg-gray-900 border border-yellow-500/30 rounded-2xl p-6 w-full max-w-sm mx-4 shadow-2xl"
            onClick={e => e.stopPropagation()}
          >
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-lg font-bold text-white">Select Wallet</h3>
              <button onClick={() => setShowWalletPicker(false)} className="text-gray-400 hover:text-white">
                <X size={20} />
              </button>
            </div>
            <div className="space-y-2">
              {discoveredWallets.map((wallet) => (
                <button
                  key={wallet.info.uuid}
                  onClick={() => selectAndConnect(wallet)}
                  className="w-full flex items-center gap-3 p-3 bg-black/40 hover:bg-yellow-500/10 border border-yellow-500/10 hover:border-yellow-500/40 rounded-xl transition-all"
                >
                  {wallet.info.icon ? (
                    <img src={wallet.info.icon} alt={wallet.info.name} className="w-8 h-8 rounded-lg" />
                  ) : (
                    <div className="w-8 h-8 rounded-lg bg-yellow-500/20 flex items-center justify-center">
                      <Wallet size={16} className="text-yellow-400" />
                    </div>
                  )}
                  <span className="font-medium text-white">{wallet.info.name}</span>
                </button>
              ))}
            </div>
          </motion.div>
        </div>
      )}

      {/* Status Toast */}
      {status && (
        <motion.div
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          className="fixed bottom-8 left-1/2 -translate-x-1/2 px-6 py-3 bg-yellow-500/20 border border-yellow-500/40 rounded-xl text-yellow-400 backdrop-blur-xl z-50"
        >
          {status}
        </motion.div>
      )}
    </div>
  );
}
