// SPDX-License-Identifier: MIT
pragma solidity ^0.8.27;

import "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/token/ERC20/extensions/ERC20Burnable.sol";

/**
 * @title DiamondClaws (DCLAW)
 * @dev ERC-20 token for Diamond Claws - combining Diamond Hands meme with OpenClaw agentic culture
 */
contract DiamondClaws is ERC20, Ownable, ERC20Burnable {
    uint256 public constant TOTAL_SUPPLY = 1_000_000_000 * 10**18; // 1 billion tokens
    
    // Tax rates (in basis points, 100 = 1%)
    uint256 public buyTaxBP = 0;      // 0% on buy/transfer
    uint256 public sellTaxBP = 800;   // 8% on sell
    uint256 public transferTaxBP = 0; // 0% on normal transfer
    
    address public stakingContract;
    address public taxWallet;
    
    bool public taxesEnabled = true;
    
    // Exclude from tax
    mapping(address => bool) public taxExcluded;
    
    event TaxRatesUpdated(uint256 sellTaxBP, uint256 transferTaxBP);
    event TaxWalletUpdated(address indexed newTaxWallet);
    event StakingContractUpdated(address indexed newStakingContract);
    event TaxesEnabled(bool enabled);
    
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
     * @dev Override transfer to include tax on sells
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
     * @dev Internal transfer with tax calculation
     */
    function _transferWithTax(address from, address to, uint256 amount) internal returns (bool) {
        if (!taxesEnabled || taxExcluded[from] || taxExcluded[to]) {
            _transfer(from, to, amount);
            return true;
        }
        
        // Determine tax rate
        uint256 taxBP = transferTaxBP;
        
        // Check if this looks like a sell (transfer to dead address or exchange)
        // For simplicity, we'll use a different tax for staking contract withdrawals
        if (to == address(0) || to == address(0xdead)) {
            taxBP = sellTaxBP;
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
     * @dev Mint tokens (for staking rewards)
     */
    function mint(address to, uint256 amount) external onlyStaking {
        _mint(to, amount);
    }
    
    /**
     * @dev Burn tokens (from staking)
     */
    function stakingBurn(address from, uint256 amount) external onlyStaking {
        _burn(from, amount);
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
        stakingContract = _stakingContract;
        taxExcluded[_stakingContract] = true;
        emit StakingContractUpdated(_stakingContract);
    }
    
    /**
     * @dev Update tax rates
     */
    function setTaxRates(uint256 _sellTaxBP, uint256 _transferTaxBP) external onlyOwner {
        require(_sellTaxBP <= 2000, "Sell tax too high"); // Max 20%
        require(_transferTaxBP <= 2000, "Transfer tax too high");
        
        sellTaxBP = _sellTaxBP;
        transferTaxBP = _transferTaxBP;
        
        emit TaxRatesUpdated(_sellTaxBP, _transferTaxBP);
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
    }
    
    /**
     * @dev Withdraw accidental ETH sent to contract
     */
    function withdrawETH() external onlyOwner {
        payable(owner()).transfer(address(this).balance);
    }
}
