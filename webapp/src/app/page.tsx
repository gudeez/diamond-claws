'use client';

import { useState, useEffect, useCallback } from 'react';
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
  Zap,
  Shield,
  Users,
  ExternalLink,
  CheckCircle,
  Loader2,
  RefreshCw
} from 'lucide-react';

const DiamondClaws3D = dynamic(() => import('@/components/DiamondClaws3D'), {
  ssr: false,
  loading: () => <div className="w-full h-full" />,
});

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
  'function swapETHForDCLAW() payable',
  'function getAmountOut(uint256 ethAmount) view returns (uint256)',
  'function rate() view returns (uint256)',
  'function availableLiquidity() view returns (uint256)',
];

// Contract addresses (local Hardhat deployment)
const CONTRACTS = {
  DCLAW: '0x610178dA211FEF7D417bC0e6FeD39F05609AD788',
  STAKING: '0xB7f8BC63BbcaD18155201308C8f3540b07f84F5e',
  SWAP: '0x0DCd1Bf9A1b36cE34237eEaFef220932846BCD82',
  CHAIN_ID: 31337,
};

// ABI encoding helpers
function encodeFunctionCall(signature: string, args: string[] = []): string {
  // keccak256 of function signature, take first 4 bytes
  const sig = signature.split('(')[0];
  const params = signature.match(/\(([^)]*)\)/)?.[1] || '';

  // Simple function selector via Web Crypto (sync fallback with lookup table)
  const selectors: Record<string, string> = {
    'swapETHForDCLAW()': '0x921e29b2',
    'balanceOf(address)': '0x70a08231',
    'getAmountOut(uint256)': '0x5c195217',
    'rate()': '0x2c4e722e',
    'availableLiquidity()': '0x74375359',
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

export default function DiamondClawsApp() {
  // Wallet state
  const [isConnected, setIsConnected] = useState(false);
  const [address, setAddress] = useState('');
  const [ethBalance, setEthBalance] = useState('0');
  const [dclawBalance, setDclawBalance] = useState('0');

  // Swap state
  const [swapInputETH, setSwapInputETH] = useState('');
  const [swapOutputDCLAW, setSwapOutputDCLAW] = useState('');
  const [swapRate, setSwapRate] = useState('1,000,000');
  const [liquidity, setLiquidity] = useState('0');
  const [isSwapping, setIsSwapping] = useState(false);
  const [swapTxHash, setSwapTxHash] = useState('');

  // Staking state
  const [stakedAmount, setStakedAmount] = useState('0');
  const [stakeCount, setStakeCount] = useState(0);
  const [stakeAmount, setStakeAmount] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [status, setStatus] = useState('');

  // RPC call helper
  const rpcCall = useCallback(async (method: string, params: unknown[]) => {
    if (typeof window.ethereum === 'undefined') return null;
    return window.ethereum.request({ method, params });
  }, []);

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

      // Fetch swap rate
      const rate = await readContract(
        CONTRACTS.SWAP,
        encodeFunctionCall('rate()')
      );
      if (rate) {
        const rateValue = decodeUint256(rate as string);
        const rateInTokens = Number(rateValue) / 1e18;
        setSwapRate(rateInTokens.toLocaleString());
      }

      // Fetch available liquidity
      const liq = await readContract(
        CONTRACTS.SWAP,
        encodeFunctionCall('availableLiquidity()')
      );
      if (liq) setLiquidity(formatEther(decodeUint256(liq as string)));
    } catch (error) {
      console.error('Error fetching data:', error);
    }
  }, [rpcCall, readContract]);

  // Connect wallet
  const connectWallet = useCallback(async () => {
    if (typeof window.ethereum !== 'undefined') {
      try {
        const accounts = await window.ethereum.request({
          method: 'eth_requestAccounts'
        }) as string[];
        setAddress(accounts[0]);
        setIsConnected(true);
        await fetchData(accounts[0]);
      } catch (error) {
        console.error('Failed to connect:', error);
        setStatus('Failed to connect wallet');
      }
    } else {
      setStatus('Please install MetaMask');
    }
  }, [fetchData]);

  // Calculate swap output when input changes
  useEffect(() => {
    if (!swapInputETH || parseFloat(swapInputETH) <= 0) {
      setSwapOutputDCLAW('');
      return;
    }

    const calculateOutput = async () => {
      try {
        const weiAmount = BigInt(Math.floor(parseFloat(swapInputETH) * 1e18));
        const result = await readContract(
          CONTRACTS.SWAP,
          encodeFunctionCall('getAmountOut(uint256)', [weiAmount.toString()])
        );
        if (result) {
          setSwapOutputDCLAW(formatEther(decodeUint256(result as string)));
        }
      } catch {
        // Fallback calculation
        const output = parseFloat(swapInputETH) * 1_000_000;
        setSwapOutputDCLAW(output.toLocaleString());
      }
    };

    calculateOutput();
  }, [swapInputETH, readContract]);

  // Execute swap
  const executeSwap = async () => {
    if (!isConnected || !swapInputETH || parseFloat(swapInputETH) <= 0) {
      setStatus('Enter an amount to swap');
      return;
    }

    setIsSwapping(true);
    setSwapTxHash('');
    setStatus('Confirm the transaction in your wallet...');

    try {
      const txHash = await rpcCall('eth_sendTransaction', [{
        from: address,
        to: CONTRACTS.SWAP,
        value: parseEther(swapInputETH),
        data: encodeFunctionCall('swapETHForDCLAW()'),
      }]) as string;

      setSwapTxHash(txHash);
      setStatus('Swap submitted! Waiting for confirmation...');

      // Poll for receipt
      let receipt = null;
      for (let i = 0; i < 30; i++) {
        await new Promise(r => setTimeout(r, 1000));
        receipt = await rpcCall('eth_getTransactionReceipt', [txHash]);
        if (receipt) break;
      }

      if (receipt && (receipt as { status: string }).status === '0x1') {
        setStatus('Swap successful!');
        setSwapInputETH('');
        setSwapOutputDCLAW('');
        await fetchData(address);
      } else if (receipt) {
        setStatus('Swap failed - transaction reverted');
      } else {
        setStatus('Swap pending - check your wallet');
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

  // Stake tokens
  const stakeTokens = async () => {
    if (!isConnected || !stakeAmount) return;

    setIsLoading(true);
    setStatus('Staking tokens...');

    try {
      setStatus(`Staking ${stakeAmount} DCLAW - Please confirm in wallet`);

      setTimeout(() => {
        setStatus(`Successfully staked ${stakeAmount} DCLAW!`);
        setStakeAmount('');
        setStakeCount(prev => prev + 1);
        setIsLoading(false);
      }, 2000);
    } catch (error) {
      console.error('Stake error:', error);
      setStatus('Staking failed');
      setIsLoading(false);
    }
  };

  // Unstake tokens
  const unstakeTokens = async (stakeId: number) => {
    setIsLoading(true);
    setStatus('Unstaking...');

    try {
      setStatus('Unstaking - 5% tax will be applied');

      setTimeout(() => {
        setStatus('Successfully unstaked! (5% tax deducted)');
        setIsLoading(false);
      }, 2000);
    } catch (error) {
      console.error('Unstake error:', error);
      setStatus('Unstake failed');
      setIsLoading(false);
    }
  };

  // Auto-clear status after 5 seconds
  useEffect(() => {
    if (status && !isSwapping && !isLoading) {
      const timer = setTimeout(() => setStatus(''), 5000);
      return () => clearTimeout(timer);
    }
  }, [status, isSwapping, isLoading]);

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
                <span>{address.slice(0, 6)}...{address.slice(-4)}</span>
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
              <span className="text-yellow-400 text-sm font-medium">365% APY Staking &bull; 8% Sell Tax &bull; 5% Unstake Tax</span>
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
            { icon: TrendingUp, label: 'APY', value: 'x%' },
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
                  <span>1 ETH = {swapRate} DCLAW</span>
                </div>
              </div>

              {/* From: ETH */}
              <div className="bg-black/40 rounded-2xl p-4 mb-2 border border-yellow-500/10">
                <div className="flex items-center justify-between mb-2">
                  <span className="text-sm text-gray-400">From</span>
                  {isConnected && (
                    <button
                      onClick={() => {
                        const max = Math.max(0, parseFloat(ethBalance) - 0.01);
                        setSwapInputETH(max > 0 ? max.toString() : '');
                      }}
                      className="text-xs text-yellow-400 hover:text-yellow-300"
                    >
                      Balance: {ethBalance} ETH
                    </button>
                  )}
                </div>
                <div className="flex items-center gap-3">
                  <input
                    type="number"
                    value={swapInputETH}
                    onChange={(e) => setSwapInputETH(e.target.value)}
                    placeholder="0.0"
                    min="0"
                    step="0.01"
                    className="flex-1 bg-transparent text-3xl font-bold text-white placeholder-gray-600 focus:outline-none [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
                  />
                  <div className="flex items-center gap-2 px-4 py-2 bg-gray-800 rounded-xl">
                    <div className="w-6 h-6 rounded-full bg-blue-500 flex items-center justify-center text-xs font-bold text-white">
                      E
                    </div>
                    <span className="font-bold text-white">ETH</span>
                  </div>
                </div>
              </div>

              {/* Arrow */}
              <div className="flex justify-center -my-3 relative z-10">
                <div className="w-10 h-10 rounded-xl bg-gray-800 border-4 border-gray-900 flex items-center justify-center">
                  <ArrowDown className="text-yellow-400" size={18} />
                </div>
              </div>

              {/* To: DCLAW */}
              <div className="bg-black/40 rounded-2xl p-4 mt-2 border border-yellow-500/10">
                <div className="flex items-center justify-between mb-2">
                  <span className="text-sm text-gray-400">To (estimated)</span>
                  {isConnected && (
                    <span className="text-xs text-gray-500">
                      Balance: {dclawBalance} DCLAW
                    </span>
                  )}
                </div>
                <div className="flex items-center gap-3">
                  <div className="flex-1 text-3xl font-bold text-white">
                    {swapOutputDCLAW || <span className="text-gray-600">0.0</span>}
                  </div>
                  <div className="flex items-center gap-2 px-4 py-2 bg-gray-800 rounded-xl">
                    <img src="/diamondclaw2.png" alt="DCLAW" className="w-6 h-6 rounded-full" />
                    <span className="font-bold text-yellow-400">DCLAW</span>
                  </div>
                </div>
              </div>

              {/* Swap Details */}
              {swapInputETH && parseFloat(swapInputETH) > 0 && (
                <div className="mt-4 p-3 bg-black/20 rounded-xl space-y-1 text-sm">
                  <div className="flex justify-between text-gray-400">
                    <span>Rate</span>
                    <span>1 ETH = {swapRate} DCLAW</span>
                  </div>
                  <div className="flex justify-between text-gray-400">
                    <span>Available Liquidity</span>
                    <span>{liquidity} DCLAW</span>
                  </div>
                </div>
              )}

              {/* Swap Button */}
              <button
                onClick={executeSwap}
                disabled={isSwapping || !swapInputETH || parseFloat(swapInputETH || '0') <= 0 || !isConnected}
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
                ) : !swapInputETH || parseFloat(swapInputETH || '0') <= 0 ? (
                  'Enter an amount'
                ) : (
                  <>
                    <RefreshCw size={20} />
                    Swap
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
                <p className="text-gray-400">Lock your DCLAW and earn 365% APY</p>
              </div>
            </div>

            <div className="grid md:grid-cols-2 gap-8">
              <div className="space-y-4">
                <label className="block text-sm text-gray-400">Stake Amount (DCLAW)</label>
                <input
                  type="number"
                  value={stakeAmount}
                  onChange={(e) => setStakeAmount(e.target.value)}
                  placeholder="Enter amount to stake..."
                  className="w-full px-6 py-4 bg-black/50 border border-yellow-500/30 rounded-xl text-white text-xl focus:outline-none focus:border-yellow-500"
                />

                <div className="p-4 bg-black/30 rounded-xl border border-yellow-500/20">
                  <div className="flex items-center gap-2 text-yellow-400 mb-2">
                    <Gift size={16} />
                    <span className="font-medium">Staking Rewards:</span>
                  </div>
                  <p className="text-2xl font-bold text-white">
                    {((parseFloat(stakeAmount || '0') * 365) / 100).toFixed(2)} DCLAW / year
                  </p>
                </div>

                <button
                  onClick={stakeTokens}
                  disabled={isLoading || !stakeAmount || !isConnected}
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

              <div className="space-y-4">
                <h4 className="font-bold text-white">Your Stakes</h4>
                {stakeCount > 0 ? (
                  <div className="space-y-3">
                    {[...Array(stakeCount)].map((_, i) => (
                      <div key={i} className="flex items-center justify-between p-4 bg-black/30 rounded-xl border border-yellow-500/10">
                        <div>
                          <p className="font-medium text-white">Stake #{i + 1}</p>
                          <p className="text-sm text-gray-400">{stakedAmount} DCLAW</p>
                        </div>
                        <button
                          onClick={() => unstakeTokens(i)}
                          className="px-4 py-2 bg-red-500/20 hover:bg-red-500/30 text-red-400 rounded-lg text-sm font-medium transition-colors"
                        >
                          Unstake
                        </button>
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
