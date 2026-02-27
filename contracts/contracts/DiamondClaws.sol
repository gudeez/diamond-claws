// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/token/ERC20/extensions/ERC20Burnable.sol";

/**
 * @title DiamondClaws (DCLAW)
 * @dev ERC-20 token for Diamond Claws - combining Diamond Hands meme with OpenClaw agentic culture.
 *      Supports buy/sell/transfer taxes via a DEX pair registry, and capped minting for staking rewards.
 */
contract DiamondClaws is ERC20, Ownable, ERC20Burnable {
    uint256 public constant TOTAL_SUPPLY = 1_000_000_000 * 10**18; // 1 billion tokens
    uint256 public constant MAX_SUPPLY = 1_100_000_000 * 10**18;   // 1.1B (base + 10% staking emissions)

    // Tax rates (in basis points, 100 = 1%)
    uint256 public buyTaxBP = 0;      // 0% on buy
    uint256 public sellTaxBP = 800;   // 8% on sell
    uint256 public transferTaxBP = 0; // 0% on normal transfer

    address public stakingContract;
    address public taxWallet;

    bool public taxesEnabled = true;

    // Exclude from tax
    mapping(address => bool) public taxExcluded;

    // DEX pair registry for buy/sell detection
    mapping(address => bool) public isDexPair;

    event TaxRatesUpdated(uint256 buyTaxBP, uint256 sellTaxBP, uint256 transferTaxBP);
    event TaxWalletUpdated(address indexed newTaxWallet);
    event StakingContractUpdated(address indexed newStakingContract);
    event TaxesEnabled(bool enabled);
    event DexPairUpdated(address indexed pair, bool enabled);
    event TaxExclusionUpdated(address indexed account, bool excluded);

    constructor(address _initialOwner, address _taxWallet)
        ERC20("Diamond Claws", "DCLAW")
        Ownable(_initialOwner)
    {
        require(_taxWallet != address(0), "Tax wallet cannot be zero address");
        taxWallet = _taxWallet;

        // Mint total supply to owner
        _mint(_initialOwner, TOTAL_SUPPLY);

        // Exclude owner and tax wallet from taxes by default
        taxExcluded[_initialOwner] = true;
        taxExcluded[_taxWallet] = true;
        taxExcluded[address(this)] = true;
    }

    modifier onlyStaking() {
        require(msg.sender == stakingContract, "Only staking contract");
        _;
    }

    /**
     * @dev Override transfer to include tax
     */
    function transfer(address to, uint256 amount) public override returns (bool) {
        return _transferWithTax(msg.sender, to, amount);
    }

    /**
     * @dev Override transferFrom to include tax
     */
    function transferFrom(address from, address to, uint256 amount) public override returns (bool) {
        address spender = msg.sender;
        _spendAllowance(from, spender, amount);
        return _transferWithTax(from, to, amount);
    }

    /**
     * @dev Internal transfer with tax calculation.
     *      - Transfer TO a DEX pair = sell → sellTaxBP
     *      - Transfer FROM a DEX pair = buy → buyTaxBP
     *      - All other transfers → transferTaxBP
     */
    function _transferWithTax(address from, address to, uint256 amount) internal returns (bool) {
        if (!taxesEnabled || taxExcluded[from] || taxExcluded[to]) {
            _transfer(from, to, amount);
            return true;
        }

        // Determine tax rate based on DEX pair registry
        uint256 taxBP;
        if (isDexPair[to]) {
            taxBP = sellTaxBP;   // Selling: sending tokens to DEX pair
        } else if (isDexPair[from]) {
            taxBP = buyTaxBP;    // Buying: receiving tokens from DEX pair
        } else {
            taxBP = transferTaxBP; // Normal transfer
        }

        if (taxBP > 0) {
            uint256 taxAmount = (amount * taxBP) / 10000;
            uint256 sendAmount = amount - taxAmount;

            _transfer(from, taxWallet, taxAmount);
            _transfer(from, to, sendAmount);
        } else {
            _transfer(from, to, amount);
        }

        return true;
    }

    /**
     * @dev Mint tokens (for staking rewards), capped at MAX_SUPPLY
     */
    function mint(address to, uint256 amount) external onlyStaking {
        require(totalSupply() + amount <= MAX_SUPPLY, "Exceeds max supply");
        _mint(to, amount);
    }

    /**
     * @dev Set tax wallet
     */
    function setTaxWallet(address _taxWallet) external onlyOwner {
        require(_taxWallet != address(0), "Invalid tax wallet");
        taxWallet = _taxWallet;
        taxExcluded[_taxWallet] = true;
        emit TaxWalletUpdated(_taxWallet);
    }

    /**
     * @dev Set staking contract
     */
    function setStakingContract(address _stakingContract) external onlyOwner {
        require(_stakingContract != address(0), "Invalid staking contract");
        stakingContract = _stakingContract;
        taxExcluded[_stakingContract] = true;
        emit StakingContractUpdated(_stakingContract);
    }

    /**
     * @dev Register or unregister a DEX pair address for buy/sell tax detection
     */
    function setDexPair(address pair, bool enabled) external onlyOwner {
        require(pair != address(0), "Invalid pair address");
        isDexPair[pair] = enabled;
        emit DexPairUpdated(pair, enabled);
    }

    /**
     * @dev Update tax rates
     */
    function setTaxRates(uint256 _buyTaxBP, uint256 _sellTaxBP, uint256 _transferTaxBP) external onlyOwner {
        require(_buyTaxBP <= 2000, "Buy tax too high");     // Max 20%
        require(_sellTaxBP <= 2000, "Sell tax too high");    // Max 20%
        require(_transferTaxBP <= 2000, "Transfer tax too high");

        buyTaxBP = _buyTaxBP;
        sellTaxBP = _sellTaxBP;
        transferTaxBP = _transferTaxBP;

        emit TaxRatesUpdated(_buyTaxBP, _sellTaxBP, _transferTaxBP);
    }

    /**
     * @dev Enable/disable taxes
     */
    function setTaxesEnabled(bool _enabled) external onlyOwner {
        taxesEnabled = _enabled;
        emit TaxesEnabled(_enabled);
    }

    /**
     * @dev Exclude account from taxes
     */
    function setTaxExcluded(address account, bool excluded) external onlyOwner {
        taxExcluded[account] = excluded;
        emit TaxExclusionUpdated(account, excluded);
    }

    /**
     * @dev Withdraw accidental ETH sent to contract
     */
    function withdrawETH() external onlyOwner {
        (bool ok, ) = payable(owner()).call{value: address(this).balance}("");
        require(ok, "ETH transfer failed");
    }
}
