// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/utils/Pausable.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

/**
 * @title zkUSD
 * @notice zkpf-native stablecoin backed 1:1 by USDC reserves
 * @dev Users can mint zkUSD by depositing USDC and redeem USDC by burning zkUSD
 * 
 * Key features:
 * - 1:1 collateralization with USDC
 * - Permissionless minting/redemption
 * - Proof-of-reserves compatible with zkpf circuits
 * - Emergency pause functionality
 */
contract zkUSD is ERC20, Ownable, Pausable, ReentrancyGuard {
    using SafeERC20 for IERC20;

    /// @notice The reserve asset (USDC)
    IERC20 public immutable reserveAsset;

    /// @notice Minimum mint/redeem amount (prevents dust)
    uint256 public minAmount = 1e6; // $1 minimum

    /// @notice Protocol fee in basis points (0 = no fee)
    uint256 public feeBps = 0;

    /// @notice Fee recipient address
    address public feeRecipient;

    /// @notice Total fees collected (for transparency)
    uint256 public totalFeesCollected;

    // Events
    event Mint(address indexed user, uint256 usdcAmount, uint256 zkUsdMinted, uint256 fee);
    event Redeem(address indexed user, uint256 zkUsdBurned, uint256 usdcReturned, uint256 fee);
    event FeeUpdated(uint256 oldFee, uint256 newFee);
    event MinAmountUpdated(uint256 oldMin, uint256 newMin);
    event FeeRecipientUpdated(address oldRecipient, address newRecipient);
    event EmergencyWithdraw(address indexed to, uint256 amount);

    /// @notice Constructor
    /// @param _reserveAsset Address of USDC (or other reserve stablecoin)
    /// @param _feeRecipient Address to receive protocol fees
    constructor(
        address _reserveAsset,
        address _feeRecipient
    ) ERC20("zkpf USD", "zkUSD") Ownable(msg.sender) {
        require(_reserveAsset != address(0), "Invalid reserve asset");
        reserveAsset = IERC20(_reserveAsset);
        feeRecipient = _feeRecipient;
    }

    /**
     * @notice Mint zkUSD by depositing USDC
     * @param usdcAmount Amount of USDC to deposit (6 decimals)
     * @return zkUsdAmount Amount of zkUSD minted
     */
    function mint(uint256 usdcAmount) external nonReentrant whenNotPaused returns (uint256 zkUsdAmount) {
        require(usdcAmount >= minAmount, "Below minimum amount");

        // Calculate fee
        uint256 fee = (usdcAmount * feeBps) / 10000;
        uint256 netAmount = usdcAmount - fee;

        // Transfer USDC from user
        reserveAsset.safeTransferFrom(msg.sender, address(this), usdcAmount);

        // Transfer fee to recipient
        if (fee > 0 && feeRecipient != address(0)) {
            reserveAsset.safeTransfer(feeRecipient, fee);
            totalFeesCollected += fee;
        }

        // Mint zkUSD 1:1 with net USDC (same decimals)
        zkUsdAmount = netAmount;
        _mint(msg.sender, zkUsdAmount);

        emit Mint(msg.sender, usdcAmount, zkUsdAmount, fee);
    }

    /**
     * @notice Redeem USDC by burning zkUSD
     * @param zkUsdAmount Amount of zkUSD to burn
     * @return usdcAmount Amount of USDC returned
     */
    function redeem(uint256 zkUsdAmount) external nonReentrant whenNotPaused returns (uint256 usdcAmount) {
        require(zkUsdAmount >= minAmount, "Below minimum amount");
        require(balanceOf(msg.sender) >= zkUsdAmount, "Insufficient balance");

        // Calculate fee
        uint256 fee = (zkUsdAmount * feeBps) / 10000;
        uint256 netAmount = zkUsdAmount - fee;

        // Burn zkUSD
        _burn(msg.sender, zkUsdAmount);

        // Transfer net USDC to user
        usdcAmount = netAmount;
        reserveAsset.safeTransfer(msg.sender, usdcAmount);

        // Transfer fee worth of USDC to recipient
        if (fee > 0 && feeRecipient != address(0)) {
            reserveAsset.safeTransfer(feeRecipient, fee);
            totalFeesCollected += fee;
        }

        emit Redeem(msg.sender, zkUsdAmount, usdcAmount, fee);
    }

    /**
     * @notice Get current reserve ratio (should always be >= 100%)
     * @return ratio Reserve ratio in basis points (10000 = 100%)
     */
    function reserveRatio() external view returns (uint256 ratio) {
        uint256 supply = totalSupply();
        if (supply == 0) return 10000;
        
        uint256 reserves = reserveAsset.balanceOf(address(this));
        ratio = (reserves * 10000) / supply;
    }

    /**
     * @notice Get proof-of-reserves data for zkpf circuit verification
     * @return reserves Current USDC balance held
     * @return supply Current zkUSD total supply
     * @return ratio Reserve ratio in basis points
     */
    function getReserveProof() external view returns (
        uint256 reserves,
        uint256 supply,
        uint256 ratio
    ) {
        reserves = reserveAsset.balanceOf(address(this));
        supply = totalSupply();
        ratio = supply == 0 ? 10000 : (reserves * 10000) / supply;
    }

    /**
     * @notice Check if a redemption of given amount would succeed
     * @param amount Amount to check
     * @return canRedeem True if redemption would succeed
     * @return availableLiquidity Current USDC available
     */
    function canRedeemAmount(uint256 amount) external view returns (
        bool canRedeem,
        uint256 availableLiquidity
    ) {
        availableLiquidity = reserveAsset.balanceOf(address(this));
        canRedeem = amount <= availableLiquidity && amount >= minAmount;
    }

    // ============ Admin Functions ============

    /**
     * @notice Update protocol fee (max 1%)
     * @param newFeeBps New fee in basis points
     */
    function setFee(uint256 newFeeBps) external onlyOwner {
        require(newFeeBps <= 100, "Fee too high"); // Max 1%
        emit FeeUpdated(feeBps, newFeeBps);
        feeBps = newFeeBps;
    }

    /**
     * @notice Update minimum mint/redeem amount
     * @param newMin New minimum amount
     */
    function setMinAmount(uint256 newMin) external onlyOwner {
        emit MinAmountUpdated(minAmount, newMin);
        minAmount = newMin;
    }

    /**
     * @notice Update fee recipient
     * @param newRecipient New fee recipient address
     */
    function setFeeRecipient(address newRecipient) external onlyOwner {
        emit FeeRecipientUpdated(feeRecipient, newRecipient);
        feeRecipient = newRecipient;
    }

    /**
     * @notice Pause minting and redemptions
     */
    function pause() external onlyOwner {
        _pause();
    }

    /**
     * @notice Unpause minting and redemptions
     */
    function unpause() external onlyOwner {
        _unpause();
    }

    /**
     * @notice Emergency withdrawal of excess reserves (only surplus above 100% collateral)
     * @param to Recipient address
     * @param amount Amount to withdraw
     */
    function emergencyWithdraw(address to, uint256 amount) external onlyOwner {
        uint256 reserves = reserveAsset.balanceOf(address(this));
        uint256 supply = totalSupply();
        
        // Can only withdraw excess reserves
        require(reserves > supply, "No excess reserves");
        uint256 excess = reserves - supply;
        require(amount <= excess, "Amount exceeds excess reserves");

        reserveAsset.safeTransfer(to, amount);
        emit EmergencyWithdraw(to, amount);
    }

    // ============ ERC20 Overrides ============

    /**
     * @notice Returns the number of decimals (matches USDC: 6)
     */
    function decimals() public pure override returns (uint8) {
        return 6;
    }
}

