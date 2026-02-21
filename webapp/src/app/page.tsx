'use client';

import { useState, useEffect, useCallback } from 'react';
import { motion } from 'framer-motion';
import { 
  Wallet, 
  TrendingUp, 
  Lock, 
  Gift, 
  Coins, 
  ArrowRight,
  Zap,
  Shield,
  Users,
  ExternalLink,
  CreditCard,
  CheckCircle,
  Loader2
} from 'lucide-react';

// x402 Payment API types
interface PaymentRequest {
  scheme: string;
  protocol: string;
  maxAmount: string;
  maxTimeout: number;
  intervals: number;
}

interface x402Payment {
  version: string;
  scheme: string;
  description: string;
  address: string;
  amount: string;
  chainId: number;
  currency: string;
}

// Contract ABIs (simplified for demo)
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

// Contract addresses (demo - replace with actual addresses)
const CONTRACTS = {
  DCLAW: '0x742d35Cc6634C0532925a3b844Bc9e7595f0AbBe', // Replace after deploy
  STAKING: '0x1234567890123456789012345678901234567890', // Replace after deploy
  CHAIN_ID: 11155111, // Sepolia testnet
};

export default function DiamondClawsApp() {
  // State
  const [isConnected, setIsConnected] = useState(false);
  const [address, setAddress] = useState('');
  const [balance, setBalance] = useState('0');
  const [stakedAmount, setStakedAmount] = useState('0');
  const [stakeCount, setStakeCount] = useState(0);
  const [buyAmount, setBuyAmount] = useState('');
  const [stakeAmount, setStakeAmount] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [paymentInfo, setPaymentInfo] = useState<x402Payment | null>(null);
  const [status, setStatus] = useState('');

  // Connect wallet (simplified - would use wagmi in production)
  const connectWallet = useCallback(async () => {
    if (typeof window.ethereum !== 'undefined') {
      try {
        const accounts = await window.ethereum.request({ 
          method: 'eth_requestAccounts' 
        });
        setAddress(accounts[0]);
        setIsConnected(true);
        await fetchBalances(accounts[0]);
      } catch (error) {
        console.error('Failed to connect:', error);
        setStatus('Failed to connect wallet');
      }
    } else {
      setStatus('Please install MetaMask or use a smart wallet');
    }
  }, []);

  // Fetch balances
  const fetchBalances = async (userAddress: string) => {
    try {
      // In production, use wagmi/viem to read from contracts
      // For demo, we'll show mock data
      setBalance('10000.00');
      setStakeCount(1);
      setStakedAmount('5000.00');
    } catch (error) {
      console.error('Error fetching balances:', error);
    }
  };

  // Fetch x402 payment info
  const fetchPaymentInfo = useCallback(async () => {
    try {
      // x402 protocol: GET /api/payment/dclaw?amount=X
      const response = await fetch('/api/payment/dclaw?amount=' + (buyAmount || '100'));
      if (response.status === 402) {
        const payment = await response.json();
        setPaymentInfo(payment);
      } else {
        const data = await response.json();
        setPaymentInfo(data);
      }
    } catch (error) {
      console.error('Error fetching payment info:', error);
      // Fallback: direct token purchase without x402
      setPaymentInfo({
        version: '1.0',
        scheme: 'erc20',
        description: 'Buy DCLAW tokens directly',
        address: CONTRACTS.DCLAW,
        amount: (parseFloat(buyAmount || '100') * 1000).toString(), // Mock price: 1 ETH = 1000 DCLAW
        chainId: CONTRACTS.CHAIN_ID,
        currency: 'ETH',
      });
    }
  }, [buyAmount]);

  // Buy tokens with x402
  const buyTokens = async () => {
    if (!isConnected) {
      setStatus('Please connect your wallet first');
      return;
    }

    setIsLoading(true);
    setStatus('Processing purchase...');

    try {
      // Check if x402 payment is available
      if (paymentInfo && paymentInfo.scheme === 'erc20') {
        // Direct ERC-20 purchase via smart contract
        // In production, implement proper contract interaction
        setStatus('Please send ETH to the contract to receive DCLAW');
      } else {
        // Standard x402 payment flow
        // The server would handle the 402 response with payment details
        const response = await fetch('/api/payment/dclaw', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ 
            amount: buyAmount,
            buyer: address,
          }),
        });

        if (response.status === 402) {
          // Payment required - extract payment info from headers
          const paymentHeader = response.headers.get('WWW-Authenticate');
          setStatus(`Payment required: ${paymentHeader}`);
        } else {
          const result = await response.json();
          setStatus(`Purchase complete! Transaction: ${result.txHash}`);
          await fetchBalances(address);
        }
      }
    } catch (error) {
      console.error('Purchase error:', error);
      setStatus('Purchase failed. Please try again.');
    } finally {
      setIsLoading(false);
    }
  };

  // Stake tokens
  const stakeTokens = async () => {
    if (!isConnected || !stakeAmount) return;

    setIsLoading(true);
    setStatus('Staking tokens...');

    try {
      // In production, use wagmi to call stake function
      // This would trigger a wallet signature/tx
      setStatus(`Staking ${stakeAmount} DCLAW - Please confirm in wallet`);
      
      // Simulate stake
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
      // Simulate unstake with 5% tax
      setStatus(`Unstaking - 5% tax will be applied`);
      
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

  useEffect(() => {
    if (buyAmount) {
      fetchPaymentInfo();
    }
  }, [buyAmount, fetchPaymentInfo]);

  return (
    <div className="min-h-screen bg-gradient-to-b from-gray-950 via-gray-900 to-gray-950">
      {/* Header */}
      <header className="border-b border-yellow-500/20 bg-black/50 backdrop-blur-xl sticky top-0 z-50">
        <div className="max-w-7xl mx-auto px-4 py-4 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-12 h-12 rounded-xl bg-gradient-to-br from-yellow-400 to-yellow-600 flex items-center justify-center text-2xl animate-glow">
              🦀
            </div>
            <div>
              <h1 className="text-2xl font-bold text-gradient">Diamond Claws</h1>
              <p className="text-xs text-yellow-500/70">DCLAW • HODL Forever</p>
            </div>
          </div>

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
      </header>

      <main className="max-w-7xl mx-auto px-4 py-8">
        {/* Hero Section */}
        <motion.div 
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          className="text-center mb-12"
        >
          <div className="inline-flex items-center gap-2 px-4 py-2 bg-yellow-500/10 border border-yellow-500/30 rounded-full mb-6">
            <Zap className="text-yellow-400" size={16} />
            <span className="text-yellow-400 text-sm font-medium">365% APY Staking • 8% Sell Tax • 5% Unstake Tax</span>
          </div>
          
          <h2 className="text-5xl md:text-7xl font-black mb-6">
            <span className="text-gradient">HODL</span> Like a
            <br />
            <span className="text-white">Diamond Crab</span> 🦀
          </h2>
          
          <p className="text-xl text-gray-400 max-w-2xl mx-auto mb-8">
            The ultimate conviction token. Combine the Diamond Hands meme with OpenClaw's agentic culture. 
            Never sell. Never unstake. Become one with the diamond claw.
          </p>

          <div className="flex flex-wrap justify-center gap-4">
            <a href="#buy" className="flex items-center gap-2 px-8 py-4 bg-yellow-500 hover:bg-yellow-400 text-black font-bold rounded-xl transition-all hover:scale-105 glow-effect">
              <CreditCard size={20} />
              Buy DCLAW
              <ArrowRight size={20} />
            </a>
            <a href="#stake" className="flex items-center gap-2 px-8 py-4 bg-gray-800 hover:bg-gray-700 border border-yellow-500/30 text-white font-bold rounded-xl transition-all">
              <Lock size={20} />
              Stake & Earn
            </a>
          </div>
        </motion.div>

        {/* Stats Cards */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-12">
          {[
            { icon: Coins, label: 'Total Supply', value: '1B DCLAW' },
            { icon: Users, label: 'Diamond Holders', value: '12,847' },
            { icon: TrendingUp, label: 'APY', value: '365%' },
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

        {/* Buy Section */}
        <section id="buy" className="mb-16">
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true }}
            className="card-gradient rounded-3xl p-8 md:p-12"
          >
            <div className="flex items-center gap-3 mb-8">
              <div className="w-12 h-12 rounded-xl bg-yellow-500/20 flex items-center justify-center">
                <CreditCard className="text-yellow-400" size={24} />
              </div>
              <div>
                <h3 className="text-2xl font-bold text-white">Buy DCLAW</h3>
                <p className="text-gray-400">Purchase using smart accounts or x402 payments</p>
              </div>
            </div>

            <div className="grid md:grid-cols-2 gap-8">
              <div className="space-y-4">
                <label className="block text-sm text-gray-400">Amount (ETH or USD)</label>
                <input
                  type="number"
                  value={buyAmount}
                  onChange={(e) => setBuyAmount(e.target.value)}
                  placeholder="Enter amount..."
                  className="w-full px-6 py-4 bg-black/50 border border-yellow-500/30 rounded-xl text-white text-xl focus:outline-none focus:border-yellow-500"
                />
                
                {paymentInfo && (
                  <div className="p-4 bg-black/30 rounded-xl border border-yellow-500/20">
                    <div className="flex items-center gap-2 text-yellow-400 mb-2">
                      <CheckCircle size={16} />
                      <span className="font-medium">You'll receive:</span>
                    </div>
                    <p className="text-2xl font-bold text-white">
                      {(parseFloat(buyAmount || '0') * 1000).toLocaleString()} DCLAW
                    </p>
                    <p className="text-sm text-gray-400 mt-1">
                      via {paymentInfo.scheme === 'erc20' ? 'Smart Contract' : 'x402 Payment'}
                    </p>
                  </div>
                )}

                <button
                  onClick={buyTokens}
                  disabled={isLoading || !buyAmount}
                  className="w-full py-4 bg-yellow-500 hover:bg-yellow-400 disabled:bg-gray-700 text-black font-bold rounded-xl transition-all flex items-center justify-center gap-2"
                >
                  {isLoading ? (
                    <>
                      <Loader2 className="animate-spin" size={20} />
                      Processing...
                    </>
                  ) : (
                    <>
                      <Zap size={20} />
                      Buy Now
                    </>
                  )}
                </button>
              </div>

              <div className="space-y-4">
                <h4 className="font-bold text-white">Payment Methods</h4>
                <div className="space-y-3">
                  {[
                    { name: 'Smart Account (Biconomy)', desc: 'Gasless transactions' },
                    { name: 'x402 Protocol', desc: 'Streaming payments' },
                    { name: 'Direct Transfer', desc: 'Send ETH to contract' },
                  ].map((method) => (
                    <div key={method.name} className="flex items-center justify-between p-4 bg-black/30 rounded-xl border border-yellow-500/10">
                      <div>
                        <p className="font-medium text-white">{method.name}</p>
                        <p className="text-sm text-gray-400">{method.desc}</p>
                      </div>
                      <CheckCircle className="text-green-500" size={20} />
                    </div>
                  ))}
                </div>
              </div>
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
                <h3 className="text-2xl font-bold text-white">Stake & Earn</h3>
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
                  ⚠️ 5% tax on unstaking. Early unstaking ({"<"}7 days) incurs 10% tax.
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
            className="fixed bottom-8 left-1/2 -translate-x-1/2 px-6 py-3 bg-yellow-500/20 border border-yellow-500/40 rounded-xl text-yellow-400 backdrop-blur-xl"
          >
            {status}
          </motion.div>
        )}
      </main>

      {/* Footer */}
      <footer className="border-t border-yellow-500/20 bg-black/50 py-8">
        <div className="max-w-7xl mx-auto px-4 text-center">
          <div className="flex items-center justify-center gap-2 mb-4">
            <span className="text-2xl">🦀</span>
            <span className="text-xl font-bold text-gradient">Diamond Claws</span>
          </div>
          <p className="text-gray-500 text-sm">
            Built with 💛 for the OpenClaw community • Powered by x402 & Smart Accounts
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
