// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {PoFCredentialVerifier} from "./PoFCredentialVerifier.sol";

/// @title PrivateCreditLine
/// @notice DeFi protocol for undercollateralized lending using zkpf credentials.
/// @dev Consumes ZEC credentials verified via PoFCredentialVerifier to extend
///      credit lines without requiring on-chain collateral. Assets stay on Zcash;
///      only zk proofs + anonymous account tags flow cross-chain.
///
/// USE CASES:
/// - Money markets: Undercollateralized borrowing backed by shielded ZEC
/// - OTC desks: Private credit for large trades without doxxing positions
/// - RFQ pools: Priority access and better rates for proven holders
contract PrivateCreditLine {
    // ═══════════════════════════════════════════════════════════════════════════
    // TYPES
    // ═══════════════════════════════════════════════════════════════════════════

    /// @notice Credit line status
    enum LineStatus {
        INACTIVE,       // No active credit line
        ACTIVE,         // Credit line is active
        FROZEN,         // Temporarily frozen (e.g., pending credential refresh)
        LIQUIDATED      // Credit line was liquidated
    }

    /// @notice A user's credit line
    struct CreditLine {
        bytes32 accountTag;       // Anonymous account identifier (from ZEC credential)
        bytes32 credentialId;     // Active credential backing this line
        uint256 creditLimit;      // Maximum borrowable amount
        uint256 borrowed;         // Current borrowed amount
        uint256 accruedInterest;  // Accumulated interest
        uint64 lastAccrualTime;   // Last interest accrual timestamp
        uint32 interestRateBps;   // Current interest rate in basis points
        LineStatus status;        // Current status
        bool autoRenew;           // Auto-renew when credential expires
    }

    /// @notice Borrow request
    struct BorrowRequest {
        bytes32 accountTag;       // Account to borrow for
        address token;            // Token to borrow (address(0) = native)
        uint256 amount;           // Amount to borrow
        address recipient;        // Where to send funds
    }

    /// @notice Supported lending token configuration
    struct TokenConfig {
        bool enabled;             // Whether token is supported
        uint256 totalDeposited;   // Total deposits
        uint256 totalBorrowed;    // Total borrowed
        uint256 minBorrow;        // Minimum borrow amount
        uint256 maxBorrow;        // Maximum borrow per line
        uint32 baseRateBps;       // Base interest rate
    }

    // ═══════════════════════════════════════════════════════════════════════════
    // STATE
    // ═══════════════════════════════════════════════════════════════════════════

    /// @notice Reference to credential verifier
    PoFCredentialVerifier public immutable credentialVerifier;

    /// @notice Admin address
    address public admin;

    /// @notice Treasury address for interest payments
    address public treasury;

    /// @notice Minimum required ZEC tier for credit line
    PoFCredentialVerifier.ZecTier public minRequiredTier;

    /// @notice Credit lines by account tag
    mapping(bytes32 => CreditLine) public creditLines;

    /// @notice Supported tokens
    mapping(address => TokenConfig) public tokenConfigs;

    /// @notice Active lending tokens
    address[] public supportedTokens;

    /// @notice Account tag to address binding (optional, for claiming)
    mapping(bytes32 => address) public accountBindings;

    /// @notice Whitelisted borrowers (optional KYC layer)
    mapping(address => bool) public whitelistedBorrowers;

    /// @notice Whether whitelist is required
    bool public requireWhitelist;

    /// @notice Global pause
    bool public paused;

    /// @notice Total value locked
    uint256 public totalValueLocked;

    /// @notice Total credit extended
    uint256 public totalCreditExtended;

    /// @notice Total interest earned
    uint256 public totalInterestEarned;

    // ═══════════════════════════════════════════════════════════════════════════
    // EVENTS
    // ═══════════════════════════════════════════════════════════════════════════

    event CreditLineOpened(
        bytes32 indexed accountTag,
        bytes32 indexed credentialId,
        uint256 creditLimit,
        uint32 interestRateBps
    );

    event CreditLineUpdated(
        bytes32 indexed accountTag,
        uint256 newCreditLimit,
        bytes32 newCredentialId
    );

    event CreditLineClosed(
        bytes32 indexed accountTag,
        uint256 finalBorrowed,
        uint256 interestPaid
    );

    event Borrowed(
        bytes32 indexed accountTag,
        address indexed token,
        uint256 amount,
        address recipient
    );

    event Repaid(
        bytes32 indexed accountTag,
        address indexed token,
        uint256 principal,
        uint256 interest
    );

    event InterestAccrued(
        bytes32 indexed accountTag,
        uint256 amount,
        uint64 timestamp
    );

    event Deposited(address indexed depositor, address token, uint256 amount);
    event Withdrawn(address indexed withdrawer, address token, uint256 amount);
    event TokenConfigured(address token, bool enabled, uint32 baseRateBps);

    // ═══════════════════════════════════════════════════════════════════════════
    // ERRORS
    // ═══════════════════════════════════════════════════════════════════════════

    error OnlyAdmin();
    error Paused();
    error NotWhitelisted();
    error NoCreditLine();
    error CreditLineExists();
    error InsufficientCredential();
    error InsufficientCredit();
    error InsufficientLiquidity();
    error TokenNotSupported();
    error BelowMinBorrow();
    error ExceedsMaxBorrow();
    error CreditLineFrozen();
    error CreditLineLiquidated();
    error OutstandingDebt();
    error TransferFailed();
    error ZeroAmount();
    error InvalidRecipient();

    // ═══════════════════════════════════════════════════════════════════════════
    // MODIFIERS
    // ═══════════════════════════════════════════════════════════════════════════

    modifier onlyAdmin() {
        if (msg.sender != admin) revert OnlyAdmin();
        _;
    }

    modifier whenNotPaused() {
        if (paused) revert Paused();
        _;
    }

    modifier checkWhitelist() {
        if (requireWhitelist && !whitelistedBorrowers[msg.sender]) {
            revert NotWhitelisted();
        }
        _;
    }

    // ═══════════════════════════════════════════════════════════════════════════
    // CONSTRUCTOR
    // ═══════════════════════════════════════════════════════════════════════════

    /// @param _credentialVerifier PoFCredentialVerifier contract address
    /// @param _treasury Treasury address for interest payments
    /// @param _minRequiredTier Minimum ZEC tier required for credit
    constructor(
        address _credentialVerifier,
        address _treasury,
        PoFCredentialVerifier.ZecTier _minRequiredTier
    ) {
        credentialVerifier = PoFCredentialVerifier(_credentialVerifier);
        treasury = _treasury;
        minRequiredTier = _minRequiredTier;
        admin = msg.sender;
    }

    // ═══════════════════════════════════════════════════════════════════════════
    // ADMIN FUNCTIONS
    // ═══════════════════════════════════════════════════════════════════════════

    function transferAdmin(address newAdmin) external onlyAdmin {
        admin = newAdmin;
    }

    function setTreasury(address _treasury) external onlyAdmin {
        treasury = _treasury;
    }

    function setMinRequiredTier(PoFCredentialVerifier.ZecTier tier) external onlyAdmin {
        minRequiredTier = tier;
    }

    function setPaused(bool _paused) external onlyAdmin {
        paused = _paused;
    }

    function setRequireWhitelist(bool required) external onlyAdmin {
        requireWhitelist = required;
    }

    function setWhitelisted(address account, bool status) external onlyAdmin {
        whitelistedBorrowers[account] = status;
    }

    /// @notice Configure a supported token
    function configureToken(
        address token,
        bool enabled,
        uint256 minBorrow,
        uint256 maxBorrow,
        uint32 baseRateBps
    ) external onlyAdmin {
        TokenConfig storage config = tokenConfigs[token];

        // Add to supported tokens if new
        if (!config.enabled && enabled) {
            supportedTokens.push(token);
        }

        config.enabled = enabled;
        config.minBorrow = minBorrow;
        config.maxBorrow = maxBorrow;
        config.baseRateBps = baseRateBps;

        emit TokenConfigured(token, enabled, baseRateBps);
    }

    // ═══════════════════════════════════════════════════════════════════════════
    // LIQUIDITY PROVIDER FUNCTIONS
    // ═══════════════════════════════════════════════════════════════════════════

    /// @notice Deposit tokens for lending
    function deposit(address token, uint256 amount) external payable whenNotPaused {
        if (amount == 0) revert ZeroAmount();

        TokenConfig storage config = tokenConfigs[token];
        if (!config.enabled) revert TokenNotSupported();

        if (token == address(0)) {
            // Native token deposit
            if (msg.value != amount) revert ZeroAmount();
        } else {
            // ERC20 deposit
            (bool success, bytes memory data) = token.call(
                abi.encodeWithSignature(
                    "transferFrom(address,address,uint256)",
                    msg.sender,
                    address(this),
                    amount
                )
            );
            if (!success || (data.length > 0 && !abi.decode(data, (bool)))) {
                revert TransferFailed();
            }
        }

        config.totalDeposited += amount;
        totalValueLocked += amount;

        emit Deposited(msg.sender, token, amount);
    }

    /// @notice Withdraw deposited tokens (if sufficient liquidity)
    function withdraw(address token, uint256 amount) external onlyAdmin {
        TokenConfig storage config = tokenConfigs[token];
        uint256 available = config.totalDeposited - config.totalBorrowed;

        if (amount > available) revert InsufficientLiquidity();

        config.totalDeposited -= amount;
        totalValueLocked -= amount;

        _transferOut(token, msg.sender, amount);

        emit Withdrawn(msg.sender, token, amount);
    }

    // ═══════════════════════════════════════════════════════════════════════════
    // CREDIT LINE MANAGEMENT
    // ═══════════════════════════════════════════════════════════════════════════

    /// @notice Open a new credit line using a ZEC credential
    /// @param accountTag Anonymous account tag from credential
    function openCreditLine(bytes32 accountTag) external whenNotPaused checkWhitelist {
        CreditLine storage line = creditLines[accountTag];
        if (line.status == LineStatus.ACTIVE) revert CreditLineExists();

        // Check credential
        (bool hasCredential, bytes32 credentialId, uint256 availableCredit) =
            credentialVerifier.checkCredential(accountTag, minRequiredTier);

        if (!hasCredential) revert InsufficientCredential();
        if (availableCredit == 0) revert InsufficientCredit();

        // Get credential details for interest rate
        (
            PoFCredentialVerifier.ZecCredential memory cred,
            , , , ,
        ) = credentialVerifier.getCredential(credentialId);

        // Get tier-specific interest rate
        (, uint32 interestRateBps, , ) = credentialVerifier.creditConfigs(cred.tier);

        // Initialize credit line
        line.accountTag = accountTag;
        line.credentialId = credentialId;
        line.creditLimit = availableCredit;
        line.borrowed = 0;
        line.accruedInterest = 0;
        line.lastAccrualTime = uint64(block.timestamp);
        line.interestRateBps = interestRateBps;
        line.status = LineStatus.ACTIVE;
        line.autoRenew = true;

        // Bind account to caller address
        if (accountBindings[accountTag] == address(0)) {
            accountBindings[accountTag] = msg.sender;
        }

        totalCreditExtended += availableCredit;

        emit CreditLineOpened(accountTag, credentialId, availableCredit, interestRateBps);
    }

    /// @notice Refresh credit line with new/updated credential
    /// @param accountTag Account tag for the credit line
    function refreshCreditLine(bytes32 accountTag) external whenNotPaused {
        CreditLine storage line = creditLines[accountTag];
        if (line.status == LineStatus.INACTIVE) revert NoCreditLine();
        if (line.status == LineStatus.LIQUIDATED) revert CreditLineLiquidated();

        // Accrue interest first
        _accrueInterest(accountTag);

        // Check for updated credential
        (bool hasCredential, bytes32 credentialId, uint256 availableCredit) =
            credentialVerifier.checkCredential(accountTag, minRequiredTier);

        if (!hasCredential) {
            // No valid credential - freeze the line
            line.status = LineStatus.FROZEN;
            return;
        }

        // Update credit line
        uint256 oldLimit = line.creditLimit;
        line.credentialId = credentialId;
        line.creditLimit = availableCredit;
        line.status = LineStatus.ACTIVE;

        // Update total credit tracking
        if (availableCredit > oldLimit) {
            totalCreditExtended += availableCredit - oldLimit;
        }

        emit CreditLineUpdated(accountTag, availableCredit, credentialId);
    }

    /// @notice Close credit line (requires repayment of all debt)
    function closeCreditLine(bytes32 accountTag) external {
        CreditLine storage line = creditLines[accountTag];
        if (line.status == LineStatus.INACTIVE) revert NoCreditLine();

        // Only account owner or admin can close
        require(
            msg.sender == accountBindings[accountTag] || msg.sender == admin,
            "unauthorized"
        );

        // Accrue final interest
        _accrueInterest(accountTag);

        // Must repay all debt first
        if (line.borrowed + line.accruedInterest > 0) revert OutstandingDebt();

        // Close the line
        totalCreditExtended -= line.creditLimit;

        uint256 finalBorrowed = line.borrowed;
        uint256 interestPaid = line.accruedInterest;

        delete creditLines[accountTag];

        emit CreditLineClosed(accountTag, finalBorrowed, interestPaid);
    }

    // ═══════════════════════════════════════════════════════════════════════════
    // BORROWING
    // ═══════════════════════════════════════════════════════════════════════════

    /// @notice Borrow against a credit line
    function borrow(
        bytes32 accountTag,
        address token,
        uint256 amount,
        address recipient
    ) external whenNotPaused checkWhitelist {
        if (amount == 0) revert ZeroAmount();
        if (recipient == address(0)) revert InvalidRecipient();

        CreditLine storage line = creditLines[accountTag];
        if (line.status != LineStatus.ACTIVE) {
            if (line.status == LineStatus.FROZEN) revert CreditLineFrozen();
            if (line.status == LineStatus.LIQUIDATED) revert CreditLineLiquidated();
            revert NoCreditLine();
        }

        // Only account owner can borrow
        require(msg.sender == accountBindings[accountTag], "unauthorized");

        // Validate token
        TokenConfig storage tokenConfig = tokenConfigs[token];
        if (!tokenConfig.enabled) revert TokenNotSupported();
        if (amount < tokenConfig.minBorrow) revert BelowMinBorrow();
        if (amount > tokenConfig.maxBorrow) revert ExceedsMaxBorrow();

        // Check liquidity
        uint256 available = tokenConfig.totalDeposited - tokenConfig.totalBorrowed;
        if (amount > available) revert InsufficientLiquidity();

        // Accrue interest first
        _accrueInterest(accountTag);

        // Check credit limit
        uint256 totalOwed = line.borrowed + line.accruedInterest;
        uint256 remainingCredit = line.creditLimit > totalOwed
            ? line.creditLimit - totalOwed
            : 0;

        if (amount > remainingCredit) revert InsufficientCredit();

        // Use credit from credential verifier
        credentialVerifier.useCredit(line.credentialId, amount);

        // Update state
        line.borrowed += amount;
        tokenConfig.totalBorrowed += amount;

        // Transfer tokens
        _transferOut(token, recipient, amount);

        emit Borrowed(accountTag, token, amount, recipient);
    }

    // ═══════════════════════════════════════════════════════════════════════════
    // REPAYMENT
    // ═══════════════════════════════════════════════════════════════════════════

    /// @notice Repay borrowed amount + interest
    function repay(
        bytes32 accountTag,
        address token,
        uint256 amount
    ) external payable whenNotPaused {
        if (amount == 0) revert ZeroAmount();

        CreditLine storage line = creditLines[accountTag];
        if (line.status == LineStatus.INACTIVE) revert NoCreditLine();

        TokenConfig storage tokenConfig = tokenConfigs[token];
        if (!tokenConfig.enabled) revert TokenNotSupported();

        // Accrue interest first
        _accrueInterest(accountTag);

        // Calculate payment allocation (interest first)
        uint256 interestPayment = amount > line.accruedInterest
            ? line.accruedInterest
            : amount;
        uint256 principalPayment = amount - interestPayment;

        if (principalPayment > line.borrowed) {
            principalPayment = line.borrowed;
        }

        // Transfer tokens in
        if (token == address(0)) {
            if (msg.value != amount) revert ZeroAmount();
        } else {
            (bool success, bytes memory data) = token.call(
                abi.encodeWithSignature(
                    "transferFrom(address,address,uint256)",
                    msg.sender,
                    address(this),
                    amount
                )
            );
            if (!success || (data.length > 0 && !abi.decode(data, (bool)))) {
                revert TransferFailed();
            }
        }

        // Update state
        line.accruedInterest -= interestPayment;
        line.borrowed -= principalPayment;
        tokenConfig.totalBorrowed -= principalPayment;
        tokenConfig.totalDeposited += interestPayment; // Interest goes to pool

        totalInterestEarned += interestPayment;

        // Send interest to treasury
        if (interestPayment > 0 && treasury != address(0)) {
            _transferOut(token, treasury, interestPayment);
        }

        // Unfreeze line if it was frozen due to insufficient credit
        if (line.status == LineStatus.FROZEN && line.borrowed == 0) {
            line.status = LineStatus.ACTIVE;
        }

        emit Repaid(accountTag, token, principalPayment, interestPayment);
    }

    // ═══════════════════════════════════════════════════════════════════════════
    // VIEW FUNCTIONS
    // ═══════════════════════════════════════════════════════════════════════════

    /// @notice Get credit line details with current interest
    function getCreditLine(bytes32 accountTag) external view returns (
        CreditLine memory line,
        uint256 currentInterest,
        uint256 totalOwed,
        uint256 availableCredit
    ) {
        line = creditLines[accountTag];
        currentInterest = _calculatePendingInterest(accountTag);
        totalOwed = line.borrowed + line.accruedInterest + currentInterest;
        availableCredit = line.creditLimit > totalOwed
            ? line.creditLimit - totalOwed
            : 0;
    }

    /// @notice Get available liquidity for a token
    function getAvailableLiquidity(address token) external view returns (uint256) {
        TokenConfig storage config = tokenConfigs[token];
        return config.totalDeposited - config.totalBorrowed;
    }

    /// @notice Get all supported tokens
    function getSupportedTokens() external view returns (address[] memory) {
        return supportedTokens;
    }

    /// @notice Get utilization rate for a token (in basis points)
    function getUtilizationRate(address token) external view returns (uint256) {
        TokenConfig storage config = tokenConfigs[token];
        if (config.totalDeposited == 0) return 0;
        return (config.totalBorrowed * 10000) / config.totalDeposited;
    }

    // ═══════════════════════════════════════════════════════════════════════════
    // INTERNAL FUNCTIONS
    // ═══════════════════════════════════════════════════════════════════════════

    function _accrueInterest(bytes32 accountTag) internal {
        CreditLine storage line = creditLines[accountTag];
        if (line.borrowed == 0) {
            line.lastAccrualTime = uint64(block.timestamp);
            return;
        }

        uint256 pending = _calculatePendingInterest(accountTag);
        if (pending > 0) {
            line.accruedInterest += pending;
            emit InterestAccrued(accountTag, pending, uint64(block.timestamp));
        }

        line.lastAccrualTime = uint64(block.timestamp);
    }

    function _calculatePendingInterest(bytes32 accountTag) internal view returns (uint256) {
        CreditLine storage line = creditLines[accountTag];
        if (line.borrowed == 0) return 0;

        uint256 timeElapsed = block.timestamp - line.lastAccrualTime;
        if (timeElapsed == 0) return 0;

        // Interest = principal * rate * time / (365 days * 10000)
        uint256 interest = (line.borrowed * line.interestRateBps * timeElapsed)
            / (365 days * 10000);

        return interest;
    }

    function _transferOut(address token, address to, uint256 amount) internal {
        if (token == address(0)) {
            (bool success,) = to.call{value: amount}("");
            if (!success) revert TransferFailed();
        } else {
            (bool success, bytes memory data) = token.call(
                abi.encodeWithSignature("transfer(address,uint256)", to, amount)
            );
            if (!success || (data.length > 0 && !abi.decode(data, (bool)))) {
                revert TransferFailed();
            }
        }
    }

    /// @notice Receive native token
    receive() external payable {}
}

