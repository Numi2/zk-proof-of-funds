// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {IAxelarGateway} from "./IAxelarGateway.sol";

/// @title PoFCredentialVerifier
/// @notice Verifies Zcash proof-of-funds and issues cross-chain credit credentials.
/// @dev This contract receives zk proofs from the zkpf system, verifies they meet
///      threshold requirements, and stores credentials that can be consumed by
///      downstream DeFi protocols (money markets, OTC desks, RFQ pools).
contract PoFCredentialVerifier {
    // ═══════════════════════════════════════════════════════════════════════════
    // TYPES
    // ═══════════════════════════════════════════════════════════════════════════

    /// @notice Balance threshold tiers for Zcash credentials
    enum ZecTier {
        TIER_01,    // ≥ 0.1 ZEC
        TIER_1,     // ≥ 1 ZEC  
        TIER_10,    // ≥ 10 ZEC
        TIER_100,   // ≥ 100 ZEC
        TIER_1000,  // ≥ 1000 ZEC
        TIER_10000  // ≥ 10000 ZEC
    }

    /// @notice ZEC credential representing proven shielded balance
    struct ZecCredential {
        bytes32 accountTag;       // Anonymous account identifier
        ZecTier tier;             // Minimum balance tier proven
        uint256 policyId;         // Policy ID for verification rules
        bytes32 stateRoot;        // State tree root at proof time
        uint64 blockHeight;       // Block height at proof time
        uint64 issuedAt;          // Timestamp when issued
        uint64 expiresAt;         // Expiration timestamp
        bytes32 proofCommitment;  // Nullifier hash (prevents reuse)
        bytes32 attestationHash;  // For cross-referencing
        bool revoked;             // Whether credential is revoked
    }

    /// @notice Credit line configuration per tier
    struct CreditConfig {
        uint32 multiplierBps;     // Credit multiplier in basis points
        uint32 interestRateBps;   // Annual interest rate in bps
        uint128 maxCreditCap;     // Maximum credit in destination units
        bool active;              // Whether this config is active
    }

    /// @notice Stored credential with additional metadata
    struct StoredCredential {
        ZecCredential credential;
        address issuer;           // Address that issued the credential
        uint256 creditUsed;       // Amount of credit used from this credential
        uint256 maxCredit;        // Maximum credit available
    }

    // ═══════════════════════════════════════════════════════════════════════════
    // CONSTANTS
    // ═══════════════════════════════════════════════════════════════════════════

    /// @notice ZEC decimals (8 = 1e8 zatoshis per ZEC)
    uint8 public constant ZEC_DECIMALS = 8;

    /// @notice Base policy ID for ZEC tier credentials
    uint256 public constant ZEC_TIER_POLICY_BASE = 400000;

    /// @notice Zatoshis per ZEC
    uint64 public constant ZATOSHIS_PER_ZEC = 100_000_000;

    /// @notice Tier thresholds in zatoshis
    uint64[6] public TIER_THRESHOLDS = [
        10_000_000,        // 0.1 ZEC
        100_000_000,       // 1 ZEC
        1_000_000_000,     // 10 ZEC
        10_000_000_000,    // 100 ZEC
        100_000_000_000,   // 1000 ZEC
        1_000_000_000_000  // 10000 ZEC
    ];

    // ═══════════════════════════════════════════════════════════════════════════
    // STATE
    // ═══════════════════════════════════════════════════════════════════════════

    /// @notice Reference to the Axelar Gateway
    IAxelarGateway public immutable gateway;

    /// @notice Admin address
    address public admin;

    /// @notice Authorized issuers (can create credentials)
    mapping(address => bool) public authorizedIssuers;

    /// @notice Trusted source bridges per chain
    mapping(bytes32 => string) public trustedSources;

    /// @notice Credentials by ID
    mapping(bytes32 => StoredCredential) public credentials;

    /// @notice User's active credentials (accountTag => credentialId[])
    mapping(bytes32 => bytes32[]) public userCredentials;

    /// @notice Used nullifiers to prevent proof reuse
    mapping(bytes32 => bool) public usedNullifiers;

    /// @notice Credit configurations per tier
    mapping(ZecTier => CreditConfig) public creditConfigs;

    /// @notice ZEC price in USD cents (updated by oracle)
    uint256 public zecPriceCents = 5000; // Default $50

    /// @notice Price oracle address
    address public priceOracle;

    /// @notice Default validity window for credentials (seconds)
    uint64 public defaultValidityWindow = 86400; // 24 hours

    /// @notice Total credentials issued
    uint256 public totalCredentialsIssued;

    // ═══════════════════════════════════════════════════════════════════════════
    // EVENTS
    // ═══════════════════════════════════════════════════════════════════════════

    event CredentialIssued(
        bytes32 indexed credentialId,
        bytes32 indexed accountTag,
        ZecTier tier,
        uint64 expiresAt,
        uint256 maxCredit
    );

    event CredentialRevoked(
        bytes32 indexed credentialId,
        bytes32 indexed accountTag,
        uint8 reason
    );

    event CredentialUsed(
        bytes32 indexed credentialId,
        bytes32 indexed accountTag,
        address indexed consumer,
        uint256 amount
    );

    event CreditConfigUpdated(ZecTier tier, uint32 multiplierBps, uint32 interestRateBps);
    event PriceUpdated(uint256 oldPrice, uint256 newPrice);
    event IssuerAuthorized(address issuer, bool authorized);
    event TrustedSourceAdded(string chainName, string sourceAddress);
    event AdminTransferred(address oldAdmin, address newAdmin);

    // ═══════════════════════════════════════════════════════════════════════════
    // ERRORS
    // ═══════════════════════════════════════════════════════════════════════════

    error OnlyAdmin();
    error OnlyGateway();
    error OnlyAuthorizedIssuer();
    error OnlyPriceOracle();
    error UntrustedSource();
    error InvalidPayload();
    error InvalidTier();
    error NullifierAlreadyUsed();
    error CredentialNotFound();
    error CredentialExpired();
    error CredentialRevoked();
    error InsufficientCredit();
    error TierBelowMinimum();

    // ═══════════════════════════════════════════════════════════════════════════
    // MODIFIERS
    // ═══════════════════════════════════════════════════════════════════════════

    modifier onlyAdmin() {
        if (msg.sender != admin) revert OnlyAdmin();
        _;
    }

    modifier onlyAuthorizedIssuer() {
        if (!authorizedIssuers[msg.sender] && msg.sender != admin) {
            revert OnlyAuthorizedIssuer();
        }
        _;
    }

    modifier onlyPriceOracle() {
        if (msg.sender != priceOracle && msg.sender != admin) {
            revert OnlyPriceOracle();
        }
        _;
    }

    // ═══════════════════════════════════════════════════════════════════════════
    // CONSTRUCTOR
    // ═══════════════════════════════════════════════════════════════════════════

    /// @param _gateway Axelar Gateway contract address
    constructor(address _gateway) {
        gateway = IAxelarGateway(_gateway);
        admin = msg.sender;
        authorizedIssuers[msg.sender] = true;

        // Initialize default credit configs
        _initDefaultCreditConfigs();
    }

    function _initDefaultCreditConfigs() internal {
        creditConfigs[ZecTier.TIER_01] = CreditConfig({
            multiplierBps: 1000,   // 10%
            interestRateBps: 800,  // 8%
            maxCreditCap: 500 * 1e6, // $500 max
            active: true
        });

        creditConfigs[ZecTier.TIER_1] = CreditConfig({
            multiplierBps: 2500,   // 25%
            interestRateBps: 600,  // 6%
            maxCreditCap: 5000 * 1e6, // $5000 max
            active: true
        });

        creditConfigs[ZecTier.TIER_10] = CreditConfig({
            multiplierBps: 5000,   // 50%
            interestRateBps: 500,  // 5%
            maxCreditCap: 50000 * 1e6, // $50000 max
            active: true
        });

        creditConfigs[ZecTier.TIER_100] = CreditConfig({
            multiplierBps: 6500,   // 65%
            interestRateBps: 400,  // 4%
            maxCreditCap: 500000 * 1e6, // $500000 max
            active: true
        });

        creditConfigs[ZecTier.TIER_1000] = CreditConfig({
            multiplierBps: 7500,   // 75%
            interestRateBps: 300,  // 3%
            maxCreditCap: 5000000 * 1e6, // $5M max
            active: true
        });

        creditConfigs[ZecTier.TIER_10000] = CreditConfig({
            multiplierBps: 8500,   // 85%
            interestRateBps: 250,  // 2.5%
            maxCreditCap: type(uint128).max, // No cap
            active: true
        });
    }

    // ═══════════════════════════════════════════════════════════════════════════
    // ADMIN FUNCTIONS
    // ═══════════════════════════════════════════════════════════════════════════

    /// @notice Transfer admin role
    function transferAdmin(address newAdmin) external onlyAdmin {
        emit AdminTransferred(admin, newAdmin);
        admin = newAdmin;
    }

    /// @notice Authorize/deauthorize an issuer
    function setAuthorizedIssuer(address issuer, bool authorized) external onlyAdmin {
        authorizedIssuers[issuer] = authorized;
        emit IssuerAuthorized(issuer, authorized);
    }

    /// @notice Add a trusted source bridge
    function addTrustedSource(
        string calldata chainName,
        string calldata sourceAddress
    ) external onlyAdmin {
        bytes32 key = keccak256(bytes(chainName));
        trustedSources[key] = sourceAddress;
        emit TrustedSourceAdded(chainName, sourceAddress);
    }

    /// @notice Update credit configuration for a tier
    function setCreditConfig(
        ZecTier tier,
        uint32 multiplierBps,
        uint32 interestRateBps,
        uint128 maxCreditCap,
        bool active
    ) external onlyAdmin {
        creditConfigs[tier] = CreditConfig({
            multiplierBps: multiplierBps,
            interestRateBps: interestRateBps,
            maxCreditCap: maxCreditCap,
            active: active
        });
        emit CreditConfigUpdated(tier, multiplierBps, interestRateBps);
    }

    /// @notice Set the price oracle address
    function setPriceOracle(address _priceOracle) external onlyAdmin {
        priceOracle = _priceOracle;
    }

    /// @notice Set default validity window
    function setDefaultValidityWindow(uint64 window) external onlyAdmin {
        defaultValidityWindow = window;
    }

    // ═══════════════════════════════════════════════════════════════════════════
    // PRICE ORACLE FUNCTIONS
    // ═══════════════════════════════════════════════════════════════════════════

    /// @notice Update ZEC price (called by oracle)
    function updatePrice(uint256 newPriceCents) external onlyPriceOracle {
        emit PriceUpdated(zecPriceCents, newPriceCents);
        zecPriceCents = newPriceCents;
    }

    // ═══════════════════════════════════════════════════════════════════════════
    // CREDENTIAL ISSUANCE
    // ═══════════════════════════════════════════════════════════════════════════

    /// @notice Issue a new ZEC credential after proof verification
    /// @param accountTag Anonymous account identifier
    /// @param tier Proven balance tier
    /// @param stateRoot State tree root at proof time
    /// @param blockHeight Block height at proof time
    /// @param proofCommitment Nullifier hash
    /// @param attestationHash Attestation hash for cross-reference
    /// @param validityWindow Custom validity window (0 = default)
    /// @return credentialId The ID of the new credential
    function issueCredential(
        bytes32 accountTag,
        ZecTier tier,
        bytes32 stateRoot,
        uint64 blockHeight,
        bytes32 proofCommitment,
        bytes32 attestationHash,
        uint64 validityWindow
    ) external onlyAuthorizedIssuer returns (bytes32 credentialId) {
        // Check nullifier hasn't been used
        if (usedNullifiers[proofCommitment]) revert NullifierAlreadyUsed();
        usedNullifiers[proofCommitment] = true;

        // Calculate timestamps
        uint64 issuedAt = uint64(block.timestamp);
        uint64 expiresAt = issuedAt + (validityWindow > 0 ? validityWindow : defaultValidityWindow);

        // Calculate policy ID
        uint256 policyId = ZEC_TIER_POLICY_BASE + uint256(tier);

        // Calculate max credit
        uint256 maxCredit = _calculateMaxCredit(tier);

        // Create credential
        ZecCredential memory cred = ZecCredential({
            accountTag: accountTag,
            tier: tier,
            policyId: policyId,
            stateRoot: stateRoot,
            blockHeight: blockHeight,
            issuedAt: issuedAt,
            expiresAt: expiresAt,
            proofCommitment: proofCommitment,
            attestationHash: attestationHash,
            revoked: false
        });

        // Generate credential ID
        credentialId = _computeCredentialId(cred);

        // Store credential
        credentials[credentialId] = StoredCredential({
            credential: cred,
            issuer: msg.sender,
            creditUsed: 0,
            maxCredit: maxCredit
        });

        // Add to user's credentials
        userCredentials[accountTag].push(credentialId);

        totalCredentialsIssued++;

        emit CredentialIssued(credentialId, accountTag, tier, expiresAt, maxCredit);
    }

    /// @notice Revoke a credential
    /// @param credentialId ID of the credential to revoke
    /// @param reason Revocation reason code
    function revokeCredential(bytes32 credentialId, uint8 reason) external onlyAuthorizedIssuer {
        StoredCredential storage stored = credentials[credentialId];
        if (stored.credential.issuedAt == 0) revert CredentialNotFound();

        stored.credential.revoked = true;

        emit CredentialRevoked(credentialId, stored.credential.accountTag, reason);
    }

    // ═══════════════════════════════════════════════════════════════════════════
    // CREDENTIAL CONSUMPTION (FOR DEFI PROTOCOLS)
    // ═══════════════════════════════════════════════════════════════════════════

    /// @notice Check if an account has valid credential for a minimum tier
    /// @param accountTag Account to check
    /// @param minTier Minimum tier required
    /// @return hasCredential True if account has valid credential meeting tier
    /// @return credentialId ID of the best matching credential
    /// @return availableCredit Remaining credit available
    function checkCredential(
        bytes32 accountTag,
        ZecTier minTier
    ) external view returns (bool hasCredential, bytes32 credentialId, uint256 availableCredit) {
        bytes32[] storage creds = userCredentials[accountTag];

        for (uint256 i = 0; i < creds.length; i++) {
            StoredCredential storage stored = credentials[creds[i]];
            ZecCredential storage cred = stored.credential;

            // Check validity
            if (cred.revoked) continue;
            if (block.timestamp >= cred.expiresAt) continue;
            if (cred.tier < minTier) continue;

            // Found valid credential meeting requirements
            uint256 remaining = stored.maxCredit > stored.creditUsed
                ? stored.maxCredit - stored.creditUsed
                : 0;

            // Return the best (highest tier) credential
            if (!hasCredential || cred.tier > credentials[credentialId].credential.tier) {
                hasCredential = true;
                credentialId = creds[i];
                availableCredit = remaining;
            }
        }
    }

    /// @notice Use credit from a credential
    /// @param credentialId ID of the credential
    /// @param amount Amount of credit to use
    function useCredit(bytes32 credentialId, uint256 amount) external {
        StoredCredential storage stored = credentials[credentialId];
        if (stored.credential.issuedAt == 0) revert CredentialNotFound();
        if (stored.credential.revoked) revert CredentialRevoked();
        if (block.timestamp >= stored.credential.expiresAt) revert CredentialExpired();

        uint256 available = stored.maxCredit > stored.creditUsed
            ? stored.maxCredit - stored.creditUsed
            : 0;
        if (amount > available) revert InsufficientCredit();

        stored.creditUsed += amount;

        emit CredentialUsed(
            credentialId,
            stored.credential.accountTag,
            msg.sender,
            amount
        );
    }

    /// @notice Get full credential details
    function getCredential(bytes32 credentialId) external view returns (
        ZecCredential memory credential,
        address issuer,
        uint256 creditUsed,
        uint256 maxCredit,
        uint256 availableCredit,
        bool isValid
    ) {
        StoredCredential storage stored = credentials[credentialId];
        credential = stored.credential;
        issuer = stored.issuer;
        creditUsed = stored.creditUsed;
        maxCredit = stored.maxCredit;
        availableCredit = maxCredit > creditUsed ? maxCredit - creditUsed : 0;
        isValid = !credential.revoked && block.timestamp < credential.expiresAt;
    }

    /// @notice Get all credential IDs for an account
    function getUserCredentials(bytes32 accountTag) external view returns (bytes32[] memory) {
        return userCredentials[accountTag];
    }

    /// @notice Get tier threshold in zatoshis
    function getTierThreshold(ZecTier tier) external view returns (uint64) {
        return TIER_THRESHOLDS[uint256(tier)];
    }

    // ═══════════════════════════════════════════════════════════════════════════
    // AXELAR GMP RECEIVER
    // ═══════════════════════════════════════════════════════════════════════════

    /// @notice Execute a cross-chain message from Axelar (for credential sync)
    function execute(
        bytes32 commandId,
        string calldata sourceChain,
        string calldata sourceAddress,
        bytes calldata payload
    ) external {
        // Validate via gateway
        bytes32 payloadHash = keccak256(payload);
        if (!gateway.validateContractCall(commandId, sourceChain, sourceAddress, payloadHash)) {
            revert UntrustedSource();
        }

        // Verify trusted source
        bytes32 chainKey = keccak256(bytes(sourceChain));
        string storage trusted = trustedSources[chainKey];
        if (bytes(trusted).length == 0) revert UntrustedSource();
        if (keccak256(bytes(trusted)) != keccak256(bytes(sourceAddress))) {
            revert UntrustedSource();
        }

        // Process the payload
        _processGmpPayload(payload);
    }

    function _processGmpPayload(bytes calldata payload) internal {
        // Decode message type (first byte)
        uint8 msgType = uint8(payload[0]);

        if (msgType == 0) {
            // Credential broadcast - decode and store
            _handleCredentialBroadcast(payload[1:]);
        } else if (msgType == 1) {
            // Credential revocation
            _handleCredentialRevocation(payload[1:]);
        }
        // Other message types can be added
    }

    function _handleCredentialBroadcast(bytes calldata data) internal {
        // Decode the credential data (ABI encoded)
        (
            bytes32 accountTag,
            uint8 tierValue,
            bytes32 stateRoot,
            uint64 blockHeight,
            uint64 issuedAt,
            uint64 expiresAt,
            bytes32 proofCommitment,
            bytes32 attestationHash
        ) = abi.decode(data, (bytes32, uint8, bytes32, uint64, uint64, uint64, bytes32, bytes32));

        // Check nullifier hasn't been used
        if (usedNullifiers[proofCommitment]) return; // Silent skip for replays
        usedNullifiers[proofCommitment] = true;

        ZecTier tier = ZecTier(tierValue);
        uint256 policyId = ZEC_TIER_POLICY_BASE + uint256(tier);
        uint256 maxCredit = _calculateMaxCredit(tier);

        ZecCredential memory cred = ZecCredential({
            accountTag: accountTag,
            tier: tier,
            policyId: policyId,
            stateRoot: stateRoot,
            blockHeight: blockHeight,
            issuedAt: issuedAt,
            expiresAt: expiresAt,
            proofCommitment: proofCommitment,
            attestationHash: attestationHash,
            revoked: false
        });

        bytes32 credentialId = _computeCredentialId(cred);

        credentials[credentialId] = StoredCredential({
            credential: cred,
            issuer: address(0), // Cross-chain issuer
            creditUsed: 0,
            maxCredit: maxCredit
        });

        userCredentials[accountTag].push(credentialId);
        totalCredentialsIssued++;

        emit CredentialIssued(credentialId, accountTag, tier, expiresAt, maxCredit);
    }

    function _handleCredentialRevocation(bytes calldata data) internal {
        (bytes32 credentialId, uint8 reason) = abi.decode(data, (bytes32, uint8));

        StoredCredential storage stored = credentials[credentialId];
        if (stored.credential.issuedAt == 0) return; // Skip if not found

        stored.credential.revoked = true;

        emit CredentialRevoked(credentialId, stored.credential.accountTag, reason);
    }

    // ═══════════════════════════════════════════════════════════════════════════
    // INTERNAL FUNCTIONS
    // ═══════════════════════════════════════════════════════════════════════════

    /// @notice Compute unique credential ID
    function _computeCredentialId(ZecCredential memory cred) internal pure returns (bytes32) {
        return keccak256(abi.encodePacked(
            cred.accountTag,
            uint8(cred.tier),
            cred.policyId,
            cred.proofCommitment,
            cred.issuedAt
        ));
    }

    /// @notice Calculate maximum credit for a tier
    function _calculateMaxCredit(ZecTier tier) internal view returns (uint256) {
        CreditConfig storage config = creditConfigs[tier];
        if (!config.active) return 0;

        // Credit = tier_threshold_zec * zec_price * multiplier / 10000
        uint256 tierThreshold = TIER_THRESHOLDS[uint256(tier)];
        uint256 tierValueCents = (tierThreshold * zecPriceCents) / ZATOSHIS_PER_ZEC;
        uint256 credit = (tierValueCents * config.multiplierBps) / 10000;

        // Apply cap
        if (credit > config.maxCreditCap) {
            credit = config.maxCreditCap;
        }

        return credit;
    }
}

