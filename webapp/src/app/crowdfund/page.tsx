'use client';

import { useState, useEffect, useCallback } from 'react';
import { motion } from 'framer-motion';
import {
  Wallet,
  Lock,
  Coins,
  ArrowLeft,
  Loader2,
  Gift,
  Timer,
  Shield,
  Users,
} from 'lucide-react';

// --- EIP-6963 types (shared with page.tsx) ---

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

// --- Contract addresses (Base Mainnet) ---

const CONTRACTS = {
  CROWDFUND: '0xeadd19817f1d8a734d353ec9b4ea194f2e51bf9a',
  DCLAW: '0x778f108fbf1faa1ea735cc146f18c5a0b49cb47c',
  CHAIN_ID: 8453,
};

const BASE_RPC = 'https://base-rpc.publicnode.com';

// --- ABI selectors ---

const SEL = {
  deposit: '0xd0e30db0',
  claim: '0x4e71d92d',
  refund: '0x590e1ae3',
  deposits: '0xfc7e286d',
  totalDeposited: '0xff50abdc',
  state: '0xc19d93fb',
  startTime: '0x78e97925',
  endTime: '0x3197cbb6',
  maxPerWallet: '0x453c2310',
  minRaise: '0xcebf3bb7',
  dclawForContributors: '0xcd92e495',
  dclawForLiquidity: '0xdf800a6f',
  ethRefundable: '0x81641889',
  claimed: '0xc884ef83',
  getClaimable: '0xa583024b',
  isOpen: '0x47535d7b',
  isRefundable: '0x2c1fecfe',
};

// --- Helpers ---

function padAddress(addr: string): string {
  return addr.replace('0x', '').toLowerCase().padStart(64, '0');
}

const WEI = BigInt('1000000000000000000'); // 1e18
const ZERO = BigInt(0);
const TEN_THOUSAND = BigInt(10000);

function formatEth(wei: bigint): string {
  const whole = wei / WEI;
  const frac = ((wei % WEI) * TEN_THOUSAND) / WEI;
  return `${whole}.${frac.toString().padStart(4, '0')}`;
}

function formatDclaw(wei: bigint): string {
  const whole = wei / WEI;
  if (whole >= BigInt(1_000_000)) return `${(Number(whole) / 1_000_000).toFixed(1)}M`;
  if (whole >= BigInt(1_000)) return `${(Number(whole) / 1_000).toFixed(1)}K`;
  return whole.toString();
}

// State enum from contract
enum CrowdfundState { OPEN, FINALIZED, CANCELLED }

export default function CrowdfundPage() {
  // Wallet
  const [providers, setProviders] = useState<EIP6963ProviderDetail[]>([]);
  const [selectedProvider, setSelectedProvider] = useState<EIP1193Provider | null>(null);
  const [selectedWalletName, setSelectedWalletName] = useState('');
  const [address, setAddress] = useState('');
  const [isConnected, setIsConnected] = useState(false);

  // Contract state
  const [contractState, setContractState] = useState<CrowdfundState>(CrowdfundState.OPEN);
  const [startTime, setStartTime] = useState(0);
  const [endTime, setEndTime] = useState(0);
  const [totalDeposited, setTotalDeposited] = useState(ZERO);
  const [maxPerWallet, setMaxPerWallet] = useState(ZERO);
  const [minRaise, setMinRaise] = useState(ZERO);
  const [dclawForContributors, setDclawForContributors] = useState(ZERO);
  const [dclawForLiquidity, setDclawForLiquidity] = useState(ZERO);
  const [ethRefundable, setEthRefundable] = useState(ZERO);
  const [userDeposit, setUserDeposit] = useState(ZERO);
  const [userClaimed, setUserClaimed] = useState(false);
  const [claimableDclaw, setClaimableDclaw] = useState(ZERO);
  const [claimableEth, setClaimableEth] = useState(ZERO);
  const [isOpenView, setIsOpenView] = useState(false);
  const [isRefundableView, setIsRefundableView] = useState(false);

  // UI
  const [depositAmount, setDepositAmount] = useState('');
  const [loading, setLoading] = useState(false);
  const [txStatus, setTxStatus] = useState('');
  const [countdown, setCountdown] = useState('');
  const [ethBalance, setEthBalance] = useState('0');

  // --- EIP-6963 wallet discovery ---

  useEffect(() => {
    const discovered: EIP6963ProviderDetail[] = [];
    const handler = (e: Event) => {
      const detail = (e as EIP6963AnnounceProviderEvent).detail;
      if (!discovered.find(d => d.info.uuid === detail.info.uuid)) {
        discovered.push(detail);
        setProviders([...discovered]);
      }
    };
    window.addEventListener('eip6963:announceProvider', handler);
    window.dispatchEvent(new Event('eip6963:requestProvider'));
    return () => window.removeEventListener('eip6963:announceProvider', handler);
  }, []);

  // --- RPC helper ---

  const rpc = useCallback(async (method: string, params: unknown[]) => {
    const res = await fetch(BASE_RPC, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', method, params, id: 1 }),
    });
    const json = await res.json();
    return json.result;
  }, []);

  const callContract = useCallback(async (data: string): Promise<string> => {
    return await rpc('eth_call', [{ to: CONTRACTS.CROWDFUND, data }, 'latest']);
  }, [rpc]);

  // --- Fetch contract state ---

  const fetchState = useCallback(async (userAddr?: string) => {
    if (CONTRACTS.CROWDFUND === '0x0000000000000000000000000000000000000000') return;

    try {
      const [
        stateHex, startHex, endHex, totalHex, maxHex, minHex,
        contribHex, lpHex, refundableHex, openHex, refHex,
      ] = await Promise.all([
        callContract(SEL.state),
        callContract(SEL.startTime),
        callContract(SEL.endTime),
        callContract(SEL.totalDeposited),
        callContract(SEL.maxPerWallet),
        callContract(SEL.minRaise),
        callContract(SEL.dclawForContributors),
        callContract(SEL.dclawForLiquidity),
        callContract(SEL.ethRefundable),
        callContract(SEL.isOpen),
        callContract(SEL.isRefundable),
      ]);

      setContractState(Number(BigInt(stateHex)));
      setStartTime(Number(BigInt(startHex)));
      setEndTime(Number(BigInt(endHex)));
      setTotalDeposited(BigInt(totalHex));
      setMaxPerWallet(BigInt(maxHex));
      setMinRaise(BigInt(minHex));
      setDclawForContributors(BigInt(contribHex));
      setDclawForLiquidity(BigInt(lpHex));
      setEthRefundable(BigInt(refundableHex));
      setIsOpenView(BigInt(openHex) !== ZERO);
      setIsRefundableView(BigInt(refHex) !== ZERO);

      if (userAddr) {
        const [depHex, claimedHex, claimableHex] = await Promise.all([
          callContract(SEL.deposits + padAddress(userAddr)),
          callContract(SEL.claimed + padAddress(userAddr)),
          callContract(SEL.getClaimable + padAddress(userAddr)),
        ]);

        setUserDeposit(BigInt(depHex));
        setUserClaimed(BigInt(claimedHex) !== ZERO);

        // getClaimable returns (uint256, uint256) - decode both
        const hex = claimableHex.replace('0x', '');
        setClaimableDclaw(BigInt('0x' + hex.slice(0, 64)));
        setClaimableEth(BigInt('0x' + hex.slice(64, 128)));

        // ETH balance
        const balHex = await rpc('eth_getBalance', [userAddr, 'latest']);
        const bal = BigInt(balHex);
        setEthBalance(formatEth(bal));
      }
    } catch (e) {
      console.error('Failed to fetch state:', e);
    }
  }, [callContract, rpc]);

  // --- Wallet connection ---

  const connectWallet = useCallback(async () => {
    let provider: EIP1193Provider;
    let name: string;

    if (providers.length === 0) {
      const eth = (window as unknown as { ethereum?: EIP1193Provider }).ethereum;
      if (typeof window !== 'undefined' && eth) {
        provider = eth;
        name = 'Browser Wallet';
      } else {
        setTxStatus('No wallet found. Install MetaMask or another EIP-6963 wallet.');
        return;
      }
    } else {
      const detail = providers[0];
      provider = detail.provider;
      name = detail.info.name;
    }

    try {
      const accounts = (await provider.request({ method: 'eth_requestAccounts' })) as string[];
      if (accounts.length > 0) {
        setSelectedProvider(provider);
        setSelectedWalletName(name);
        setAddress(accounts[0]);
        setIsConnected(true);

        // Switch to Base
        try {
          await provider.request({
            method: 'wallet_switchEthereumChain',
            params: [{ chainId: '0x' + CONTRACTS.CHAIN_ID.toString(16) }],
          });
        } catch {
          // Chain may not be added
        }
      }
    } catch (e) {
      console.error('Connection failed:', e);
    }
  }, [providers]);

  // --- Polling ---

  useEffect(() => {
    fetchState(address || undefined);
    const iv = setInterval(() => fetchState(address || undefined), 10000);
    return () => clearInterval(iv);
  }, [address, fetchState]);

  // --- Countdown timer ---

  useEffect(() => {
    const tick = () => {
      const now = Math.floor(Date.now() / 1000);
      let target = 0;
      let prefix = '';

      if (now < startTime) {
        target = startTime;
        prefix = 'Starts in ';
      } else if (now < endTime && contractState === CrowdfundState.OPEN) {
        target = endTime;
        prefix = 'Ends in ';
      } else {
        setCountdown('');
        return;
      }

      const diff = target - now;
      if (diff <= 0) { setCountdown(''); return; }

      const d = Math.floor(diff / 86400);
      const h = Math.floor((diff % 86400) / 3600);
      const m = Math.floor((diff % 3600) / 60);
      const s = diff % 60;

      let str = prefix;
      if (d > 0) str += `${d}d `;
      str += `${h.toString().padStart(2, '0')}:${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
      setCountdown(str);
    };

    tick();
    const iv = setInterval(tick, 1000);
    return () => clearInterval(iv);
  }, [startTime, endTime, contractState]);

  // --- Transactions ---

  const sendTx = async (data: string, value?: string) => {
    if (!selectedProvider || !address) return;
    setLoading(true);
    setTxStatus('Sending transaction...');
    try {
      const txHash = await selectedProvider.request({
        method: 'eth_sendTransaction',
        params: [{
          from: address,
          to: CONTRACTS.CROWDFUND,
          data,
          ...(value ? { value } : {}),
        }],
      });
      setTxStatus(`TX sent: ${(txHash as string).slice(0, 10)}... waiting for confirmation`);
      // Poll for receipt
      for (let i = 0; i < 60; i++) {
        await new Promise(r => setTimeout(r, 2000));
        const receipt = await rpc('eth_getTransactionReceipt', [txHash]);
        if (receipt) {
          if (receipt.status === '0x1') {
            setTxStatus('Transaction confirmed!');
            fetchState(address);
          } else {
            setTxStatus('Transaction reverted.');
          }
          break;
        }
      }
    } catch (e) {
      setTxStatus(`Error: ${(e as Error).message || 'Transaction failed'}`);
    } finally {
      setLoading(false);
    }
  };

  const handleDeposit = () => {
    if (!depositAmount || parseFloat(depositAmount) <= 0) return;
    const weiHex = '0x' + (BigInt(Math.floor(parseFloat(depositAmount) * 1e18))).toString(16);
    sendTx(SEL.deposit, weiHex);
    setDepositAmount('');
  };

  const handleClaim = () => sendTx(SEL.claim);
  const handleRefund = () => sendTx(SEL.refund);

  // --- Progress bar ---

  const progressPct = minRaise > ZERO
    ? Math.min(100, Number((totalDeposited * BigInt(100)) / minRaise))
    : totalDeposited > ZERO ? 100 : 0;

  const remainingAllowance = maxPerWallet > userDeposit ? maxPerWallet - userDeposit : ZERO;

  // --- Render ---

  return (
    <div className="min-h-screen bg-gradient-to-b from-gray-950 via-gray-900 to-gray-950">
      {/* Header */}
      <header className="border-b border-yellow-500/20 bg-black/50 backdrop-blur-xl sticky top-0 z-50">
        <div className="max-w-7xl mx-auto px-4 py-4 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <a href="/" className="flex items-center gap-3">
              <img src="/diamondclaw2.png" alt="Diamond Claws" className="w-12 h-12 rounded-xl" />
              <div>
                <h1 className="text-2xl font-bold bg-gradient-to-r from-yellow-400 to-yellow-600 bg-clip-text text-transparent">Diamond Claws</h1>
                <p className="text-xs text-yellow-500/70">DCLAW &bull; These Claws Don&apos;t Sell</p>
              </div>
            </a>
          </div>

          <div className="flex items-center gap-4">
            <nav className="hidden md:flex items-center gap-1 text-sm">
              <a href="/" className="px-3 py-1.5 text-gray-400 hover:text-yellow-400 hover:bg-yellow-500/10 rounded-lg transition-colors">Home</a>
              <a href="/positions" className="px-3 py-1.5 text-gray-400 hover:text-yellow-400 hover:bg-yellow-500/10 rounded-lg transition-colors">Positions</a>
              <span className="px-3 py-1.5 text-yellow-400 font-medium bg-yellow-500/10 rounded-lg">Crowdfund</span>
            </nav>
            {isConnected && (
              <div className="hidden md:flex items-center gap-3 text-sm">
                <span className="text-gray-400">{ethBalance} ETH</span>
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
        {/* Back link */}
        <a href="/" className="inline-flex items-center gap-2 text-gray-400 hover:text-yellow-400 mb-6 transition-colors">
          <ArrowLeft size={16} /> Back to Home
        </a>

        {/* Hero */}
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          className="text-center mb-10"
        >
          <h2 className="text-4xl font-bold bg-gradient-to-r from-yellow-400 to-yellow-600 bg-clip-text text-transparent mb-3">
            Fair Launch Crowdfund
          </h2>
          <p className="text-gray-400 text-lg max-w-2xl mx-auto">
            Deposit ETH to fund liquidity for DCLAW. All ETH is paired with DCLAW to seed permanent,
            locked liquidity. Contributors receive proportional DCLAW tokens.
          </p>
          {countdown && (
            <div className="mt-4 inline-flex items-center gap-2 px-4 py-2 bg-yellow-500/10 border border-yellow-500/20 rounded-xl">
              <Timer size={18} className="text-yellow-400" />
              <span className="text-yellow-400 font-mono text-lg font-bold">{countdown}</span>
            </div>
          )}
        </motion.div>

        {/* Stats Grid */}
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.1 }}
          className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-8"
        >
          <div className="bg-gray-800/50 border border-gray-700/50 rounded-xl p-5">
            <div className="flex items-center gap-2 text-gray-400 text-sm mb-1">
              <Coins size={16} /> Total ETH Raised
            </div>
            <div className="text-2xl font-bold text-white">{formatEth(totalDeposited)} ETH</div>
            {minRaise > ZERO && (
              <div className="mt-2">
                <div className="flex justify-between text-xs text-gray-500 mb-1">
                  <span>Min: {formatEth(minRaise)} ETH</span>
                  <span>{progressPct}%</span>
                </div>
                <div className="w-full bg-gray-700 rounded-full h-1.5">
                  <div
                    className="bg-yellow-500 h-1.5 rounded-full transition-all"
                    style={{ width: `${progressPct}%` }}
                  />
                </div>
              </div>
            )}
          </div>

          <div className="bg-gray-800/50 border border-gray-700/50 rounded-xl p-5">
            <div className="flex items-center gap-2 text-gray-400 text-sm mb-1">
              <Users size={16} /> Your Deposit
            </div>
            <div className="text-2xl font-bold text-white">{formatEth(userDeposit)} ETH</div>
            {maxPerWallet > ZERO && (
              <div className="text-xs text-gray-500 mt-1">
                Max: {formatEth(maxPerWallet)} ETH per wallet
              </div>
            )}
          </div>

          <div className="bg-gray-800/50 border border-gray-700/50 rounded-xl p-5">
            <div className="flex items-center gap-2 text-gray-400 text-sm mb-1">
              <Gift size={16} /> DCLAW for Contributors
            </div>
            <div className="text-2xl font-bold text-yellow-400">{formatDclaw(dclawForContributors)}</div>
            <div className="text-xs text-gray-500 mt-1">
              + {formatDclaw(dclawForLiquidity)} for LP (locked)
            </div>
          </div>
        </motion.div>

        {/* Action Panel */}
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.2 }}
          className="bg-gray-800/50 border border-gray-700/50 rounded-xl p-6 mb-8"
        >
          {/* OPEN state — deposit form */}
          {isOpenView && (
            <>
              <h3 className="text-xl font-bold text-white mb-4">Deposit ETH</h3>
              {!isConnected ? (
                <p className="text-gray-400">Connect your wallet to participate.</p>
              ) : (
                <div className="space-y-4">
                  <div>
                    <div className="flex items-center justify-between mb-2">
                      <label className="text-sm text-gray-400">Amount (ETH)</label>
                      <span className="text-xs text-gray-500">
                        Remaining allowance: {formatEth(remainingAllowance)} ETH
                      </span>
                    </div>
                    <div className="flex gap-3">
                      <input
                        type="number"
                        step="0.01"
                        min="0"
                        max={Number(remainingAllowance) / 1e18}
                        value={depositAmount}
                        onChange={e => setDepositAmount(e.target.value)}
                        placeholder="0.0"
                        className="flex-1 bg-gray-900 border border-gray-600 rounded-lg px-4 py-3 text-white focus:border-yellow-500 focus:outline-none"
                      />
                      <button
                        onClick={() => setDepositAmount((Number(remainingAllowance) / 1e18).toString())}
                        className="px-4 py-3 bg-gray-700 hover:bg-gray-600 text-gray-300 rounded-lg text-sm"
                      >
                        Max
                      </button>
                    </div>
                  </div>
                  <button
                    onClick={handleDeposit}
                    disabled={loading || !depositAmount || parseFloat(depositAmount) <= 0}
                    className="w-full py-3 bg-yellow-500 hover:bg-yellow-400 disabled:bg-gray-600 disabled:text-gray-400 text-black font-bold rounded-xl transition-all flex items-center justify-center gap-2"
                  >
                    {loading ? <Loader2 size={20} className="animate-spin" /> : <Coins size={20} />}
                    Deposit ETH
                  </button>
                </div>
              )}
            </>
          )}

          {/* FINALIZED state — claim panel */}
          {contractState === CrowdfundState.FINALIZED && (
            <>
              <h3 className="text-xl font-bold text-white mb-4">Claim Your DCLAW</h3>
              {!isConnected ? (
                <p className="text-gray-400">Connect your wallet to claim.</p>
              ) : userClaimed ? (
                <div className="text-center py-6">
                  <div className="text-green-400 text-lg font-medium">You have already claimed your tokens.</div>
                </div>
              ) : userDeposit === ZERO ? (
                <div className="text-center py-6">
                  <div className="text-gray-400">You did not participate in this crowdfund.</div>
                </div>
              ) : (
                <div className="space-y-4">
                  <div className="bg-gray-900/50 rounded-lg p-4 space-y-2">
                    <div className="flex justify-between">
                      <span className="text-gray-400">Your deposit</span>
                      <span className="text-white font-medium">{formatEth(userDeposit)} ETH</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-gray-400">DCLAW to claim</span>
                      <span className="text-yellow-400 font-medium">{formatDclaw(claimableDclaw)} DCLAW</span>
                    </div>
                    {claimableEth > ZERO && (
                      <div className="flex justify-between">
                        <span className="text-gray-400">ETH refund</span>
                        <span className="text-white font-medium">{formatEth(claimableEth)} ETH</span>
                      </div>
                    )}
                  </div>
                  <button
                    onClick={handleClaim}
                    disabled={loading}
                    className="w-full py-3 bg-yellow-500 hover:bg-yellow-400 disabled:bg-gray-600 text-black font-bold rounded-xl transition-all flex items-center justify-center gap-2"
                  >
                    {loading ? <Loader2 size={20} className="animate-spin" /> : <Gift size={20} />}
                    Claim DCLAW
                  </button>
                </div>
              )}
            </>
          )}

          {/* CANCELLED or below min raise — refund panel */}
          {isRefundableView && (
            <>
              <h3 className="text-xl font-bold text-white mb-4">Refund Available</h3>
              <p className="text-gray-400 mb-4">
                {contractState === CrowdfundState.CANCELLED
                  ? 'The crowdfund has been cancelled. You can withdraw your ETH.'
                  : 'The minimum raise was not met. You can withdraw your ETH.'}
              </p>
              {isConnected && userDeposit > ZERO && (
                <button
                  onClick={handleRefund}
                  disabled={loading}
                  className="w-full py-3 bg-red-500 hover:bg-red-400 disabled:bg-gray-600 text-white font-bold rounded-xl transition-all flex items-center justify-center gap-2"
                >
                  {loading ? <Loader2 size={20} className="animate-spin" /> : null}
                  Refund {formatEth(userDeposit)} ETH
                </button>
              )}
            </>
          )}

          {/* Waiting for window to open */}
          {!isOpenView && contractState === CrowdfundState.OPEN && !isRefundableView && (
            <div className="text-center py-6">
              <Timer size={32} className="text-yellow-400 mx-auto mb-3" />
              <h3 className="text-xl font-bold text-white mb-2">
                {Math.floor(Date.now() / 1000) < startTime ? 'Coming Soon' : 'Deposit Window Closed'}
              </h3>
              <p className="text-gray-400">
                {Math.floor(Date.now() / 1000) < startTime
                  ? 'The crowdfund deposit window has not started yet.'
                  : 'The deposit window has ended. Waiting for finalization.'}
              </p>
            </div>
          )}

          {/* TX status */}
          {txStatus && (
            <div className="mt-4 p-3 bg-gray-900/50 border border-gray-700 rounded-lg text-sm text-gray-300">
              {txStatus}
            </div>
          )}
        </motion.div>

        {/* How It Works */}
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.3 }}
          className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-8"
        >
          {[
            {
              icon: <Coins size={24} className="text-yellow-400" />,
              title: '1. Deposit ETH',
              desc: 'Contribute ETH during the 14-day deposit window. Max 5 ETH per wallet.',
            },
            {
              icon: <Lock size={24} className="text-yellow-400" />,
              title: '2. Liquidity Locked',
              desc: 'All ETH + 200M DCLAW are paired as permanent Uniswap v4 liquidity. No rug pulls.',
            },
            {
              icon: <Gift size={24} className="text-yellow-400" />,
              title: '3. Claim DCLAW',
              desc: '300M DCLAW distributed to contributors proportional to their ETH deposit.',
            },
          ].map((step, i) => (
            <div key={i} className="bg-gray-800/30 border border-gray-700/30 rounded-xl p-5 text-center">
              <div className="flex justify-center mb-3">{step.icon}</div>
              <h4 className="text-white font-bold mb-2">{step.title}</h4>
              <p className="text-gray-400 text-sm">{step.desc}</p>
            </div>
          ))}
        </motion.div>

        {/* Safety badge */}
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ delay: 0.4 }}
          className="flex items-center justify-center gap-3 text-sm text-gray-500 mb-8"
        >
          <Shield size={16} className="text-green-500" />
          <span>LP is permanently locked in the crowdfund contract. Rug-proof by design.</span>
        </motion.div>
      </main>
    </div>
  );
}
