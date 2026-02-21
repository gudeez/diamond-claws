# 🦀 Diamond Claws (DCLAW)

The ultimate crypto meme coin combining the Diamond Hands meme with OpenClaw's agentic culture.

![Diamond Claws](https://img.shields.io/badge/DCLAW-Diamond%20Crab-yellow)
![License](https://img.shields.io/badge/License-MIT-green)
![Solidity](https://img.shields.io/badge/Solidity-0.8.20-blue)

## ✨ Features

- **1B Total Supply** - True scarcity for maximum diamond energy
- **365% APY Staking** - Earn rewards while you HODL
- **8% Sell Tax** - Discourages paper hands, rewards diamond holders
- **5% Unstake Tax** - Encourages long-term commitment
- **Smart Accounts** - Gasless transactions via Biconomy
- **x402 Protocol** - HTTP 402 streaming payments

## 📚 Project Structure

```
diamond-claws/
├── contracts/           # Solidity smart contracts
│   ├── DiamondClaws.sol       # ERC-20 token
│   ├── DiamondClawsStaking.sol # Staking contract
│   ├── deploy.js             # Deployment script
│   ├── hardhat.config.js     # Hardhat configuration
│   └── package.json
├── webapp/              # Next.js web application
│   ├── src/
│   │   ├── app/
│   │   │   ├── page.tsx           # Main dApp
│   │   │   ├── layout.tsx
│   │   │   ├── globals.css
│   │   │   └── api/
│   │   │       └── payment/
│   │   │           └── dclaw/    # x402 payment API
│   │   └── components/
│   ├── package.json
│   └── tailwind.config.ts
└── promotion/           # Marketing materials
    ├── moltbook-promotion.md
    └── moltbook-poster.js
```

## 🚀 Quick Start

### Prerequisites

- Node.js 18+
- npm or yarn
- MetaMask or other Web3 wallet

### 1. Deploy Contracts

```bash
cd contracts
npm install
npx hardhat compile
npx hardhat run scripts/deploy.js --network localhost
```

### 2. Run Web App

```bash
cd webapp
npm install
cp .env.example .env.local
# Edit .env.local with your contract addresses
npm run dev
```

### 3. Access the App

Open http://localhost:3000 in your browser.

## 💻 Smart Contracts

### DiamondClaws (DCLAW)

ERC-20 token with tax functionality:

| Function | Description |
|----------|-------------|
| `transfer()` | Transfer with optional sell tax |
| `mint()` | Mint tokens (staking rewards) |
| `setTaxRates()` | Update tax percentages |
| `setStakingContract()` | Configure staking contract |

### DiamondClawsStaking

Staking contract with tax on unstaking:

| Function | Description |
|----------|-------------|
| `stake()` | Stake DCLAW tokens |
| `unstake()` | Unstake (5% tax applied) |
| `claimRewards()` | Claim staking rewards |
| `calculateRewards()` | View pending rewards |

## 🔌 Integrations

### x402 Payment Protocol

The web app implements the x402 protocol for seamless token purchases:

```
GET /api/payment/dclaw?amount=100&buyer=0x...
```

Returns payment info with HTTP 402 headers for streaming payments.

### Smart Accounts

Biconomy integration enables:
- Gasless transactions
- Social login
- Batch transactions
- Session keys

## 📄 Deployment

### Testnet (Sepolia)

1. Update `hardhat.config.js` with your RPC URL and private key
2. Run deployment:

```bash
cd contracts
npx hardhat run scripts/deploy.js --network sepolia
```

3. Update webapp `.env.local` with deployed addresses

### Mainnet

Follow the same process with mainnet RPC configuration.

## 🎯 Tokenomics

| Parameter | Value |
|-----------|-------|
| Total Supply | 1,000,000,000 DCLAW |
| Buy Tax | 0% |
| Sell Tax | 8% |
| Transfer Tax | 0% |
| Unstake Tax | 5% |
| Early Unstake Tax | 10% (<7 days) |
| Staking APY | 365% |

## 🤝 Contributing

1. Fork the repository
2. Create a feature branch
3. Make your changes
4. Submit a pull request

## 📜 License

MIT License - see [LICENSE](LICENSE) for details.

## 🔗 Links

- **Website:** [diamondclaws.xyz](https://diamondclaws.xyz)
- **Documentation:** [docs.diamondclaws.xyz](https://docs.diamondclaws.xyz)
- **Discord:** [discord.gg/diamondclaws](https://discord.gg/diamondclaws)
- **Twitter:** [@DiamondClaws](https://twitter.com/DiamondClaws)

---

🦀 **Diamond Claws - HODL Forever** 💎
