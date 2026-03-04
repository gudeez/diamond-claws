'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import { motion } from 'framer-motion';
import dynamic from 'next/dynamic';
import {
  Wallet,
  TrendingUp,
  Lock,
  Gift,
  Coins,
  ArrowRight,
  ArrowDown,
  ArrowUpDown,
  Zap,
  Shield,
  Users,
  ExternalLink,
  CheckCircle,
  Loader2,
  RefreshCw,
  X
} from 'lucide-react';

const DiamondClaws3D = dynamic(() => import('@/components/DiamondClaws3D'), {
  ssr: false,
  loading: () => <div className="w-full h-full" />,
});

// EIP-6963 types
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

// Contract ABIs
const DCLAW_ABI = [
  'function transfer(address to, uint256 amount) returns (bool)',
  'function approve(address spender, uint256 amount) returns (bool)',
  'function balanceOf(address account) view returns (uint256)',
  'function allowance(address owner, address spender) view returns (uint256)',
];

const STAKING_ABI = [
  'function stake(uint256 amount)',
  'function unstake(uint256 stakeId)',
  'function getStakeCount(address user) view returns (uint256)',
  'function getStakeInfo(address user, uint256 stakeId) view returns (uint256, uint256, uint256)',
  'function calculateRewards(address user, uint256 stakeId) view returns (uint256)',
];

const SWAP_ABI = [
  'function getQueueLength(tuple(address,address,uint24,int24,address)) view returns (uint256)',
];

// Contract addresses — Base Mainnet deployment
const CONTRACTS = {
  DCLAW: '0x778f108fbf1faa1ea735cc146f18c5a0b49cb47c',
  STAKING: '0x5a41279c653b04c8859062d6d364049cd37baa4b',
  POOL_MANAGER: '0x498581fF718922c3f8e6A244956aF099B2652b2b',
  SWAP_ROUTER: '0x0000000000000000000000000000000000000000',
  HOOK: '0x159fb90528f2a41f8603822bf7c0d7f664c60088',
  AGENT_REGISTRY: '0x42646bf18c9e4ce919d3c8f9e1f5ec68dff0224a',
  CHAIN_ID: 8453,
};

// ABI encoding helpers
function encodeFunctionCall(signature: string, args: string[] = []): string {
  // keccak256 of function signature, take first 4 bytes
  const sig = signature.split('(')[0];
  const params = signature.match(/\(([^)]*)\)/)?.[1] || '';

  // Simple function selector via Web Crypto (sync fallback with lookup table)
  const selectors: Record<string, string> = {
    'balanceOf(address)': '0x70a08231',
    'approve(address,uint256)': '0x095ea7b3',
    'stake(uint256)': '0xa694fc3a',
    'unstake(uint256)': '0x2e17de78',
    'claimAllRewards()': '0x0b83a727',
    'getStakeCount(address)': '0xcf57ee69',
    'getStakeInfo(address,uint256)': '0x3b521efe',
    'getTotalPendingRewards(address)': '0xa8c478ba',
    'rewardRateAPY()': '0xaac9dafc',
    'totalStaked()': '0x817b1cd2',
    // Uniswap v4 PoolSwapTest.swap() selector
    'swap(tuple,tuple,tuple,bytes)': '0xf3cd914c',
    // Agent/smart account support
    'stakeFor(address,uint256)': '0x2ee40908',
    'unstakeFor(address,uint256)': '0x36ef088c',
    'claimRewardsFor(address,uint256)': '0xe10f6046',
    'claimAllRewardsFor(address)': '0x870edfd4',
    'setOperatorApproval(address,bool)': '0xa63a1098',
    'operatorApprovals(address,address)': '0x0d95e054',
    'permit(address,address,uint256,uint256,uint8,bytes32,bytes32)': '0xd505accf',
    'nonces(address)': '0x7ecebe00',
    'DOMAIN_SEPARATOR()': '0x3644e515',
  };

  const selector = selectors[signature];
  if (!selector) return '0x';

  if (args.length === 0) return selector;

  // Encode arguments (only address and uint256 supported)
  const encodedArgs = args.map(arg => {
    if (arg.startsWith('0x')) {
      // address - pad to 32 bytes
      return arg.slice(2).toLowerCase().padStart(64, '0');
    }
    // uint256 - convert to hex and pad
    return BigInt(arg).toString(16).padStart(64, '0');
  }).join('');

  return selector + encodedArgs;
}

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

function decodeMultiple(hex: string, count: number): bigint[] {
  const clean = hex.startsWith('0x') ? hex.slice(2) : hex;
  const results: bigint[] = [];
  for (let i = 0; i < count; i++) {
    const chunk = clean.slice(i * 64, (i + 1) * 64);
    results.push(chunk ? BigInt('0x' + chunk) : BigInt(0));
  }
  return results;
}

function formatTimeSince(startTimeSeconds: bigint): string {
  const now = Math.floor(Date.now() / 1000);
  const elapsed = now - Number(startTimeSeconds);
  if (elapsed < 3600) return `${Math.floor(elapsed / 60)}m ago`;
  if (elapsed < 86400) return `${Math.floor(elapsed / 3600)}h ago`;
  return `${Math.floor(elapsed / 86400)}d ago`;
}

function isEarlyUnstake(startTimeSeconds: bigint): boolean {
  const now = Math.floor(Date.now() / 1000);
  return now - Number(startTimeSeconds) < 7 * 24 * 3600;
}

interface StakeData {
  id: number;
  amount: bigint;
  startTime: bigint;
  pendingReward: bigint;
}

export default function DiamondClawsApp() {
  // Wallet state
  const [isConnected, setIsConnected] = useState(false);
  const [address, setAddress] = useState('');
  const [ethBalance, setEthBalance] = useState('0');
  const [dclawBalance, setDclawBalance] = useState('0');

  // Swap state
  const [swapDirection, setSwapDirection] = useState<'ethToDclaw' | 'dclawToEth'>('ethToDclaw');
  const [swapInput, setSwapInput] = useState('');
  const [swapOutput, setSwapOutput] = useState('');
  const [isSwapping, setIsSwapping] = useState(false);
  const [swapTxHash, setSwapTxHash] = useState('');

  // Staking state
  const [stakes, setStakes] = useState<StakeData[]>([]);
  const [totalPendingRewards, setTotalPendingRewards] = useState<bigint>(BigInt(0));
  const [contractAPY, setContractAPY] = useState<number>(100);
  const [contractTotalStaked, setContractTotalStaked] = useState<bigint>(BigInt(0));
  const [stakeCount, setStakeCount] = useState(0);
  const [stakeAmount, setStakeAmount] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [isClaiming, setIsClaiming] = useState(false);
  const [status, setStatus] = useState('');

  // EIP-6963 wallet discovery state
  const [discoveredWallets, setDiscoveredWallets] = useState<EIP6963ProviderDetail[]>([]);
  const [selectedProvider, setSelectedProvider] = useState<EIP1193Provider | null>(null);
  const [selectedWalletName, setSelectedWalletName] = useState('');
  const [showWalletPicker, setShowWalletPicker] = useState(false);
  const walletsRef = useRef<EIP6963ProviderDetail[]>([]);

  // EIP-6963 wallet discovery
  useEffect(() => {
    const handleAnnounce = (event: Event) => {
      const e = event as EIP6963AnnounceProviderEvent;
      const detail = e.detail;
      // Deduplicate by uuid
      if (!walletsRef.current.some(w => w.info.uuid === detail.info.uuid)) {
        walletsRef.current = [...walletsRef.current, detail];
        setDiscoveredWallets([...walletsRef.current]);
      }
    };

    window.addEventListener('eip6963:announceProvider', handleAnnounce);
    window.dispatchEvent(new Event('eip6963:requestProvider'));

    // Fallback: if no EIP-6963 wallets found, use window.ethereum
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

  // RPC call helper — uses selected EIP-6963 provider instead of window.ethereum
  const rpcCall = useCallback(async (method: string, params: unknown[]) => {
    if (!selectedProvider) return null;
    return selectedProvider.request({ method, params });
  }, [selectedProvider]);

  // Read contract helper
  const readContract = useCallback(async (to: string, data: string) => {
    return rpcCall('eth_call', [{ to, data }, 'latest']);
  }, [rpcCall]);

  // Fetch all balances and contract data
  const fetchData = useCallback(async (userAddress: string) => {
    try {
      // Fetch ETH balance
      const ethBal = await rpcCall('eth_getBalance', [userAddress, 'latest']);
      if (ethBal) setEthBalance(formatEther(BigInt(ethBal as string)));

      // Fetch DCLAW balance
      const dclawBal = await readContract(
        CONTRACTS.DCLAW,
        encodeFunctionCall('balanceOf(address)', [userAddress])
      );
      if (dclawBal) setDclawBalance(formatEther(decodeUint256(dclawBal as string)));

      // Fetch staking APY
      const apyResult = await readContract(
        CONTRACTS.STAKING,
        encodeFunctionCall('rewardRateAPY()', [])
      );
      if (apyResult) setContractAPY(Number(decodeUint256(apyResult as string)));

      // Fetch total staked contract-wide
      const totalStakedResult = await readContract(
        CONTRACTS.STAKING,
        encodeFunctionCall('totalStaked()', [])
      );
      if (totalStakedResult) setContractTotalStaked(decodeUint256(totalStakedResult as string));

      // Fetch stake count
      const countResult = await readContract(
        CONTRACTS.STAKING,
        encodeFunctionCall('getStakeCount(address)', [userAddress])
      );
      const count = countResult ? Number(decodeUint256(countResult as string)) : 0;
      setStakeCount(count);

      // Fetch each stake's info
      const fetchedStakes: StakeData[] = [];
      for (let i = 0; i < count; i++) {
        const infoResult = await readContract(
          CONTRACTS.STAKING,
          encodeFunctionCall('getStakeInfo(address,uint256)', [userAddress, i.toString()])
        );
        if (infoResult) {
          const [amount, startTime, pendingReward] = decodeMultiple(infoResult as string, 3);
          if (amount > BigInt(0)) {
            fetchedStakes.push({ id: i, amount, startTime, pendingReward });
          }
        }
      }
      setStakes(fetchedStakes);

      // Fetch total pending rewards
      const pendingResult = await readContract(
        CONTRACTS.STAKING,
        encodeFunctionCall('getTotalPendingRewards(address)', [userAddress])
      );
      if (pendingResult) setTotalPendingRewards(decodeUint256(pendingResult as string));

    } catch (error) {
      console.error('Error fetching data:', error);
    }
  }, [rpcCall, readContract]);

  // Select a wallet provider and connect
  const selectAndConnect = useCallback(async (wallet: EIP6963ProviderDetail) => {
    setSelectedProvider(wallet.provider);
    setSelectedWalletName(wallet.info.name);
    setShowWalletPicker(false);
    try {
      const accounts = await wallet.provider.request({
        method: 'eth_requestAccounts',
      }) as string[];
      setAddress(accounts[0]);
      setIsConnected(true);
      // fetchData will pick up the new selectedProvider on next render via rpcCall,
      // but we need to use the provider directly here since state hasn't updated yet
      try {
        const ethBal = await wallet.provider.request({ method: 'eth_getBalance', params: [accounts[0], 'latest'] });
        if (ethBal) setEthBalance(formatEther(BigInt(ethBal as string)));
        const dclawBal = await wallet.provider.request({ method: 'eth_call', params: [{ to: CONTRACTS.DCLAW, data: encodeFunctionCall('balanceOf(address)', [accounts[0]]) }, 'latest'] });
        if (dclawBal) setDclawBalance(formatEther(decodeUint256(dclawBal as string)));
      } catch (e) { console.error('Error fetching initial data:', e); }
    } catch (error) {
      console.error('Failed to connect:', error);
      setStatus('Failed to connect wallet');
      setSelectedProvider(null);
      setSelectedWalletName('');
    }
  }, []);

  // Connect wallet — show picker if multiple wallets, auto-select if one
  const connectWallet = useCallback(async () => {
    if (isConnected) return; // Already connected
    if (discoveredWallets.length === 0) {
      setStatus('No wallet detected. Please install a wallet extension.');
      return;
    }
    if (discoveredWallets.length === 1) {
      await selectAndConnect(discoveredWallets[0]);
    } else {
      setShowWalletPicker(true);
    }
  }, [discoveredWallets, selectAndConnect, isConnected]);

  // Calculate swap output when input changes
  useEffect(() => {
    if (!swapInput || parseFloat(swapInput) <= 0) {
      setSwapOutput('');
      return;
    }
    // AMM pricing estimate — production app would use a quoter contract
    const amount = parseFloat(swapInput);
    if (swapDirection === 'ethToDclaw') {
      setSwapOutput(`~${(amount * 1_000_000).toLocaleString()}`);
    } else {
      setSwapOutput(`~${(amount / 1_000_000).toFixed(6)}`);
    }
  }, [swapInput, swapDirection]);

  // Flip swap direction
  const flipSwapDirection = () => {
    setSwapDirection(prev => prev === 'ethToDclaw' ? 'dclawToEth' : 'ethToDclaw');
    setSwapInput('');
    setSwapOutput('');
  };

  // Wait for transaction receipt helper
  const waitForReceipt = useCallback(async (txHash: string, maxAttempts = 30): Promise<boolean> => {
    for (let i = 0; i < maxAttempts; i++) {
      await new Promise(r => setTimeout(r, 1000));
      const receipt = await rpcCall('eth_getTransactionReceipt', [txHash]);
      if (receipt) return (receipt as { status: string }).status === '0x1';
    }
    return false;
  }, [rpcCall]);

  // Execute swap
  const executeSwap = async () => {
    if (!isConnected || !swapInput || parseFloat(swapInput) <= 0) {
      setStatus('Enter an amount to swap');
      return;
    }

    setIsSwapping(true);
    setSwapTxHash('');

    try {
      const isEthToDclaw = swapDirection === 'ethToDclaw';

      // For DCLAW → ETH, approve DCLAW spend first
      if (!isEthToDclaw) {
        setStatus('Approving DCLAW spend... confirm in wallet');
        const amountWei = parseEther(swapInput);
        const approveData = encodeFunctionCall('approve(address,uint256)', [
          CONTRACTS.SWAP_ROUTER,
          BigInt(amountWei).toString()
        ]);
        const approveTx = await rpcCall('eth_sendTransaction', [{
          from: address,
          to: CONTRACTS.DCLAW,
          data: approveData,
        }]) as string;

        if (!(await waitForReceipt(approveTx))) {
          setStatus('Approval failed');
          setIsSwapping(false);
          return;
        }
      }

      setStatus('Confirm the swap in your wallet...');

      const txParams: Record<string, string> = {
        from: address,
        to: CONTRACTS.SWAP_ROUTER,
        data: encodeFunctionCall('swap(tuple,tuple,tuple,bytes)'),
      };
      if (isEthToDclaw) {
        txParams.value = parseEther(swapInput);
      }

      const txHash = await rpcCall('eth_sendTransaction', [txParams]) as string;
      setSwapTxHash(txHash);
      setStatus('Swap submitted! Waiting for confirmation...');

      if (await waitForReceipt(txHash)) {
        setStatus('Swap successful!');
        setSwapInput('');
        setSwapOutput('');
        await fetchData(address);
      } else {
        setStatus('Swap failed - transaction reverted');
      }
    } catch (error: unknown) {
      console.error('Swap error:', error);
      const msg = error instanceof Error ? error.message : 'Unknown error';
      if (msg.includes('User denied') || msg.includes('rejected')) {
        setStatus('Transaction rejected');
      } else {
        setStatus('Swap failed: ' + msg.slice(0, 60));
      }
    } finally {
      setIsSwapping(false);
    }
  };

  // Stake tokens — approve DCLAW spend, then call stake()
  const stakeTokens = async () => {
    if (!isConnected || !stakeAmount || parseFloat(stakeAmount) <= 0) return;

    setIsLoading(true);
    try {
      const amountWei = parseEther(stakeAmount);

      // Step 1: Approve DCLAW spend
      setStatus('Approving DCLAW spend... confirm in wallet');
      const approveData = encodeFunctionCall('approve(address,uint256)', [
        CONTRACTS.STAKING,
        BigInt(amountWei).toString()
      ]);
      const approveTx = await rpcCall('eth_sendTransaction', [{
        from: address,
        to: CONTRACTS.DCLAW,
        data: approveData,
      }]) as string;

      if (!(await waitForReceipt(approveTx))) {
        setStatus('Approval failed');
        setIsLoading(false);
        return;
      }

      // Step 2: Stake
      setStatus(`Staking ${stakeAmount} DCLAW... confirm in wallet`);
      const stakeData = encodeFunctionCall('stake(uint256)', [
        BigInt(amountWei).toString()
      ]);
      const stakeTx = await rpcCall('eth_sendTransaction', [{
        from: address,
        to: CONTRACTS.STAKING,
        data: stakeData,
      }]) as string;

      if (await waitForReceipt(stakeTx)) {
        setStatus(`Successfully staked ${stakeAmount} DCLAW!`);
        setStakeAmount('');
        await fetchData(address);
      } else {
        setStatus('Stake transaction failed');
      }
    } catch (error: unknown) {
      console.error('Stake error:', error);
      const msg = error instanceof Error ? error.message : 'Unknown error';
      if (msg.includes('User denied') || msg.includes('rejected')) {
        setStatus('Transaction rejected');
      } else {
        setStatus('Staking failed: ' + msg.slice(0, 60));
      }
    } finally {
      setIsLoading(false);
    }
  };

  // Unstake tokens
  const unstakeTokens = async (stakeId: number) => {
    if (!isConnected) return;
    setIsLoading(true);
    try {
      const stake = stakes.find(s => s.id === stakeId);
      const taxRate = stake && isEarlyUnstake(stake.startTime) ? '10%' : '5%';
      setStatus(`Unstaking... ${taxRate} tax will be applied. Confirm in wallet.`);

      const unstakeData = encodeFunctionCall('unstake(uint256)', [stakeId.toString()]);
      const txHash = await rpcCall('eth_sendTransaction', [{
        from: address,
        to: CONTRACTS.STAKING,
        data: unstakeData,
      }]) as string;

      if (await waitForReceipt(txHash)) {
        setStatus(`Successfully unstaked! (${taxRate} tax deducted)`);
        await fetchData(address);
      } else {
        setStatus('Unstake transaction failed');
      }
    } catch (error: unknown) {
      console.error('Unstake error:', error);
      const msg = error instanceof Error ? error.message : 'Unknown error';
      if (msg.includes('User denied') || msg.includes('rejected')) {
        setStatus('Transaction rejected');
      } else {
        setStatus('Unstake failed: ' + msg.slice(0, 60));
      }
    } finally {
      setIsLoading(false);
    }
  };

  // Claim all staking rewards
  const claimAllRewards = async () => {
    if (!isConnected || totalPendingRewards === BigInt(0)) return;
    setIsClaiming(true);
    setStatus('Claiming rewards... confirm in wallet');
    try {
      const claimData = encodeFunctionCall('claimAllRewards()', []);
      const txHash = await rpcCall('eth_sendTransaction', [{
        from: address,
        to: CONTRACTS.STAKING,
        data: claimData,
      }]) as string;

      if (await waitForReceipt(txHash)) {
        setStatus(`Claimed ${formatEther(totalPendingRewards)} DCLAW in rewards!`);
        await fetchData(address);
      } else {
        setStatus('Claim transaction failed');
      }
    } catch (error: unknown) {
      console.error('Claim error:', error);
      const msg = error instanceof Error ? error.message : 'Unknown error';
      if (msg.includes('User denied') || msg.includes('rejected')) {
        setStatus('Transaction rejected');
      } else {
        setStatus('Claim failed: ' + msg.slice(0, 60));
      }
    } finally {
      setIsClaiming(false);
    }
  };

  // Auto-clear status after 5 seconds
  useEffect(() => {
    if (status && !isSwapping && !isLoading && !isClaiming) {
      const timer = setTimeout(() => setStatus(''), 5000);
      return () => clearTimeout(timer);
    }
  }, [status, isSwapping, isLoading, isClaiming]);

  // Auto-refresh data every 30 seconds (keeps rewards display current)
  useEffect(() => {
    if (!isConnected || !address) return;
    const interval = setInterval(() => fetchData(address), 30000);
    return () => clearInterval(interval);
  }, [isConnected, address, fetchData]);

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
              <span className="px-3 py-1.5 text-yellow-400 font-medium bg-yellow-500/10 rounded-lg">Home</span>
              <a href="/positions" className="px-3 py-1.5 text-gray-400 hover:text-yellow-400 hover:bg-yellow-500/10 rounded-lg transition-colors">Positions</a>
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

      <main className="max-w-7xl mx-auto px-4 py-8">
        {/* Hero Section */}
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          className="text-center mb-12 relative overflow-hidden"
        >
          {/* 3D Background */}
          <div className="absolute inset-0 pointer-events-auto" style={{ opacity: 0.5 }}>
            <DiamondClaws3D />
          </div>
          <div className="relative z-10 pointer-events-none">
            <div className="inline-flex items-center gap-2 px-4 py-2 bg-yellow-500/10 border border-yellow-500/30 rounded-full mb-6">
              <Zap className="text-yellow-400" size={16} />
              <span className="text-yellow-400 text-sm font-medium">{contractAPY}% APY Staking &bull; 8% Sell Tax &bull; 5% Unstake Tax</span>
            </div>

            <h2 className="text-5xl md:text-7xl font-black mb-6">
              <span className="text-gradient">HODL</span> With
              <br />
              <span className="text-white">Diamond Claws</span>
            </h2>

            <p className="text-xl text-gray-400 max-w-2xl mx-auto mb-8">
              The ultimate conviction token. Combine the Diamond Hands meme with OpenClaw&apos;s agentic culture.
              Never sell. Never unstake. Become one with the diamond clawture.
            </p>

            <div className="flex flex-wrap justify-center gap-4 pointer-events-auto">
              <a href="#swap" className="flex items-center gap-2 px-8 py-4 bg-yellow-500 hover:bg-yellow-400 text-black font-bold rounded-xl transition-all hover:scale-105 glow-effect">
                <RefreshCw size={20} />
                Swap ETH for DCLAW
                <ArrowRight size={20} />
              </a>
              <a href="#stake" className="flex items-center gap-2 px-8 py-4 bg-gray-800 hover:bg-gray-700 border border-yellow-500/30 text-white font-bold rounded-xl transition-all">
                <Lock size={20} />
                Stake &amp; Earn
              </a>
            </div>
          </div>
        </motion.div>

        {/* Stats Cards */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-12">
          {[
            { icon: Coins, label: 'Total Supply', value: '1B DCLAW SUPPLY' },
            { icon: Users, label: 'Diamond Holders', value: '' },
            { icon: TrendingUp, label: 'APY', value: `${contractAPY}%` },
            { icon: Shield, label: 'Tax on Sell', value: '8%' },
          ].map((stat, i) => (
            <motion.div
              key={stat.label}
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: i * 0.1 }}
              className="card-gradient p-6 rounded-2xl text-center"
            >
              <stat.icon className="mx-auto mb-2 text-yellow-400" size={24} />
              <p className="text-2xl font-bold text-white">{stat.value}</p>
              <p className="text-sm text-gray-400">{stat.label}</p>
            </motion.div>
          ))}
        </div>

        {/* Swap Section */}
        <section id="swap" className="mb-16">
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true }}
            className="max-w-lg mx-auto"
          >
            <div className="card-gradient rounded-3xl p-6 md:p-8">
              <div className="flex items-center justify-between mb-6">
                <h3 className="text-xl font-bold text-white">Swap</h3>
                <div className="flex items-center gap-2 text-xs text-gray-400">
                  <span>Uniswap v4 AMM</span>
                </div>
              </div>

              {/* From */}
              <div className="bg-black/40 rounded-2xl p-4 mb-2 border border-yellow-500/10">
                <div className="flex items-center justify-between mb-2">
                  <span className="text-sm text-gray-400">From</span>
                  {isConnected && (
                    <button
                      onClick={() => {
                        if (swapDirection === 'ethToDclaw') {
                          const max = Math.max(0, parseFloat(ethBalance) - 0.01);
                          setSwapInput(max > 0 ? max.toString() : '');
                        } else {
                          setSwapInput(dclawBalance.replace(/,/g, '') || '');
                        }
                      }}
                      className="text-xs text-yellow-400 hover:text-yellow-300"
                    >
                      Balance: {swapDirection === 'ethToDclaw' ? `${ethBalance} ETH` : `${dclawBalance} DCLAW`}
                    </button>
                  )}
                </div>
                <div className="flex items-center gap-3">
                  <input
                    type="number"
                    value={swapInput}
                    onChange={(e) => setSwapInput(e.target.value)}
                    placeholder="0.0"
                    min="0"
                    step={swapDirection === 'ethToDclaw' ? '0.01' : '1'}
                    className="flex-1 min-w-0 bg-transparent text-3xl font-bold text-white placeholder-gray-600 focus:outline-none [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
                  />
                  {swapDirection === 'ethToDclaw' ? (
                    <div className="flex items-center gap-2 px-4 py-2 bg-gray-800 rounded-xl">
                      <div className="w-6 h-6 rounded-full bg-blue-500 flex items-center justify-center text-xs font-bold text-white">E</div>
                      <span className="font-bold text-white">ETH</span>
                    </div>
                  ) : (
                    <div className="flex items-center gap-2 px-4 py-2 bg-gray-800 rounded-xl">
                      <img src="/diamondclaw2.png" alt="DCLAW" className="w-6 h-6 rounded-full" />
                      <span className="font-bold text-yellow-400">DCLAW</span>
                    </div>
                  )}
                </div>
              </div>

              {/* Flip Button */}
              <div className="flex justify-center -my-3 relative z-10">
                <button
                  onClick={flipSwapDirection}
                  className="w-10 h-10 rounded-xl bg-gray-800 border-4 border-gray-900 flex items-center justify-center hover:bg-gray-700 transition-colors cursor-pointer group"
                >
                  <ArrowUpDown className="text-yellow-400 group-hover:rotate-180 transition-transform duration-300" size={18} />
                </button>
              </div>

              {/* To */}
              <div className="bg-black/40 rounded-2xl p-4 mt-2 border border-yellow-500/10">
                <div className="flex items-center justify-between mb-2">
                  <span className="text-sm text-gray-400">To (estimated)</span>
                  {isConnected && (
                    <span className="text-xs text-gray-500">
                      Balance: {swapDirection === 'ethToDclaw' ? `${dclawBalance} DCLAW` : `${ethBalance} ETH`}
                    </span>
                  )}
                </div>
                <div className="flex items-center gap-3">
                  <div className="flex-1 text-3xl font-bold text-white">
                    {swapOutput || <span className="text-gray-600">0.0</span>}
                  </div>
                  {swapDirection === 'ethToDclaw' ? (
                    <div className="flex items-center gap-2 px-4 py-2 bg-gray-800 rounded-xl">
                      <img src="/diamondclaw2.png" alt="DCLAW" className="w-6 h-6 rounded-full" />
                      <span className="font-bold text-yellow-400">DCLAW</span>
                    </div>
                  ) : (
                    <div className="flex items-center gap-2 px-4 py-2 bg-gray-800 rounded-xl">
                      <div className="w-6 h-6 rounded-full bg-blue-500 flex items-center justify-center text-xs font-bold text-white">E</div>
                      <span className="font-bold text-white">ETH</span>
                    </div>
                  )}
                </div>
              </div>

              {/* Swap Details */}
              {swapInput && parseFloat(swapInput) > 0 && (
                <div className="mt-4 p-3 bg-black/20 rounded-xl space-y-1 text-sm">
                  <div className="flex justify-between text-gray-400">
                    <span>Rate</span>
                    <span>Uniswap v4 AMM</span>
                  </div>
                  <div className="flex justify-between text-gray-400">
                    <span>Fee</span>
                    <span>0.3%</span>
                  </div>
                </div>
              )}

              {/* Swap Button */}
              <button
                onClick={executeSwap}
                disabled={isSwapping || !swapInput || parseFloat(swapInput || '0') <= 0 || !isConnected}
                className="w-full mt-4 py-4 bg-yellow-500 hover:bg-yellow-400 disabled:bg-gray-700 disabled:cursor-not-allowed text-black font-bold rounded-2xl transition-all flex items-center justify-center gap-2 text-lg"
              >
                {!isConnected ? (
                  <>
                    <Wallet size={20} />
                    Connect Wallet
                  </>
                ) : isSwapping ? (
                  <>
                    <Loader2 className="animate-spin" size={20} />
                    Swapping...
                  </>
                ) : !swapInput || parseFloat(swapInput || '0') <= 0 ? (
                  'Enter an amount'
                ) : (
                  <>
                    <RefreshCw size={20} />
                    Swap {swapDirection === 'ethToDclaw' ? 'ETH for DCLAW' : 'DCLAW for ETH'}
                  </>
                )}
              </button>

              {/* Tx Hash */}
              {swapTxHash && (
                <div className="mt-3 text-center">
                  <span className="text-xs text-gray-500">
                    TX: {swapTxHash.slice(0, 10)}...{swapTxHash.slice(-8)}
                  </span>
                </div>
              )}
            </div>
          </motion.div>
        </section>

        {/* Staking Section */}
        <section id="stake" className="mb-16">
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true }}
            className="card-gradient rounded-3xl p-8 md:p-12"
          >
            <div className="flex items-center gap-3 mb-8">
              <div className="w-12 h-12 rounded-xl bg-yellow-500/20 flex items-center justify-center">
                <Lock className="text-yellow-400" size={24} />
              </div>
              <div>
                <h3 className="text-2xl font-bold text-white">Stake &amp; Earn</h3>
                <p className="text-gray-400">Lock your DCLAW and earn {contractAPY}% APY</p>
              </div>
            </div>

            <div className="grid md:grid-cols-2 gap-8">
              {/* Left Column — Stake Input */}
              <div className="space-y-4">
                <label className="block text-sm text-gray-400">Stake Amount (DCLAW)</label>
                <div className="relative">
                  <input
                    type="number"
                    value={stakeAmount}
                    onChange={(e) => setStakeAmount(e.target.value)}
                    placeholder="Enter amount to stake..."
                    className="w-full px-6 py-4 bg-black/50 border border-yellow-500/30 rounded-xl text-white text-xl focus:outline-none focus:border-yellow-500"
                  />
                  {isConnected && (
                    <button
                      onClick={() => setStakeAmount(dclawBalance.replace(/,/g, ''))}
                      className="absolute right-3 top-1/2 -translate-y-1/2 text-xs text-yellow-400 hover:text-yellow-300 px-2 py-1 bg-yellow-500/10 rounded"
                    >
                      MAX
                    </button>
                  )}
                </div>

                <div className="p-4 bg-black/30 rounded-xl border border-yellow-500/20">
                  <div className="flex items-center gap-2 text-yellow-400 mb-2">
                    <Gift size={16} />
                    <span className="font-medium">Estimated Rewards:</span>
                  </div>
                  <p className="text-2xl font-bold text-white">
                    {((parseFloat(stakeAmount || '0') * contractAPY) / 100).toFixed(2)} DCLAW / year
                  </p>
                  <p className="text-xs text-gray-500 mt-1">{contractAPY}% APY</p>
                </div>

                <button
                  onClick={stakeTokens}
                  disabled={isLoading || !stakeAmount || parseFloat(stakeAmount || '0') <= 0 || !isConnected}
                  className="w-full py-4 bg-yellow-500 hover:bg-yellow-400 disabled:bg-gray-700 text-black font-bold rounded-xl transition-all flex items-center justify-center gap-2"
                >
                  {isLoading ? (
                    <>
                      <Loader2 className="animate-spin" size={20} />
                      Staking...
                    </>
                  ) : (
                    <>
                      <Lock size={20} />
                      Stake Now
                    </>
                  )}
                </button>

                <p className="text-xs text-gray-500">
                  5% tax on unstaking. Early unstaking (&lt;7 days) incurs 10% tax.
                </p>
              </div>

              {/* Right Column — Stakes & Rewards */}
              <div className="space-y-4">
                {/* Claim Rewards Banner */}
                {stakes.length > 0 && totalPendingRewards > BigInt(0) && (
                  <div className="flex items-center justify-between p-4 bg-yellow-500/10 rounded-xl border border-yellow-500/30">
                    <div>
                      <p className="text-sm text-gray-400">Pending Rewards</p>
                      <p className="text-xl font-bold text-yellow-400">
                        {formatEther(totalPendingRewards)} DCLAW
                      </p>
                    </div>
                    <button
                      onClick={claimAllRewards}
                      disabled={isClaiming || totalPendingRewards === BigInt(0)}
                      className="px-5 py-2 bg-yellow-500 hover:bg-yellow-400 disabled:bg-gray-700 text-black font-bold rounded-xl transition-all flex items-center gap-2"
                    >
                      {isClaiming ? (
                        <Loader2 className="animate-spin" size={16} />
                      ) : (
                        <Gift size={16} />
                      )}
                      Claim All
                    </button>
                  </div>
                )}

                <div className="flex items-center justify-between">
                  <h4 className="font-bold text-white">Your Stakes</h4>
                  <span className="text-xs text-gray-500">
                    Total staked: {formatEther(contractTotalStaked)} DCLAW
                  </span>
                </div>

                {stakes.length > 0 ? (
                  <div className="space-y-3">
                    {stakes.map((stake) => (
                      <div key={stake.id} className="p-4 bg-black/30 rounded-xl border border-yellow-500/10">
                        <div className="flex items-center justify-between mb-2">
                          <div>
                            <p className="font-medium text-white">Stake #{stake.id + 1}</p>
                            <p className="text-sm text-gray-400">
                              {formatEther(stake.amount)} DCLAW
                            </p>
                          </div>
                          <button
                            onClick={() => unstakeTokens(stake.id)}
                            disabled={isLoading}
                            className="px-4 py-2 bg-red-500/20 hover:bg-red-500/30 disabled:opacity-50 text-red-400 rounded-lg text-sm font-medium transition-colors"
                          >
                            Unstake
                          </button>
                        </div>
                        <div className="flex items-center justify-between text-xs text-gray-500">
                          <span>Staked {formatTimeSince(stake.startTime)}</span>
                          <span className="text-yellow-400/80">
                            +{formatEther(stake.pendingReward)} DCLAW earned
                          </span>
                        </div>
                        {isEarlyUnstake(stake.startTime) ? (
                          <div className="mt-2 text-xs text-red-400/80">
                            Early unstake tax: 10% (less than 7 days)
                          </div>
                        ) : (
                          <div className="mt-2 text-xs text-yellow-500/60">
                            Unstake tax: 5%
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                ) : (
                  <div className="p-8 text-center bg-black/30 rounded-xl border border-yellow-500/10">
                    <Lock className="mx-auto mb-3 text-gray-600" size={32} />
                    <p className="text-gray-400">No active stakes</p>
                    <p className="text-sm text-gray-500">Stake your DCLAW to earn rewards!</p>
                  </div>
                )}
              </div>
            </div>
          </motion.div>
        </section>

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

        {/* Status */}
        {status && (
          <motion.div
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            className="fixed bottom-8 left-1/2 -translate-x-1/2 px-6 py-3 bg-yellow-500/20 border border-yellow-500/40 rounded-xl text-yellow-400 backdrop-blur-xl z-50"
          >
            {status}
          </motion.div>
        )}
      </main>

      {/* Footer */}
      <footer className="border-t border-yellow-500/20 bg-black/50 py-8">
        <div className="max-w-7xl mx-auto px-4 text-center">
          <div className="flex items-center justify-center gap-2 mb-4">
            <img src="/diamondclaw2-removebg-preview.png" alt="Diamond Claws" className="w-8 h-8" />
            <span className="text-xl font-bold text-gradient">Diamond Claws</span>
          </div>
          <p className="text-gray-500 text-sm">
            Built with 💛 for the OpenClaw community
          </p>
          <div className="flex justify-center gap-4 mt-4">
            <a href="#" className="text-gray-400 hover:text-yellow-400 transition-colors">
              <ExternalLink size={20} />
            </a>
            <a href="#" className="text-gray-400 hover:text-yellow-400 transition-colors">
              Contract
            </a>
          </div>
        </div>
      </footer>
    </div>
  );
}
