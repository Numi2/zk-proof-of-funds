// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {IZkpfMinaBridge} from "./IZkpfMinaBridge.sol";

/**
 * @title ZkpfMinaGatedAccess
 * @notice Example contract showing how to gate access using Mina PoF attestations
 * @dev This demonstrates the integration pattern for DeFi protocols
 *
 * Usage pattern:
 * 1. User generates PoF proof on any supported rail (Starknet, Orchard, Custodial)
 * 2. Proof is wrapped into Mina recursive proof
 * 3. Attestation is published to Mina zkApp
 * 4. User provides Merkle proof when accessing this contract
 * 5. Contract verifies via ZkpfMinaBridge
 */
abstract contract ZkpfMinaGatedAccess {
    // ============================================================
    // STATE
    // ============================================================

    /// @notice The Mina bridge contract
    IZkpfMinaBridge public immutable minaBridge;

    /// @notice Required policy ID for access
    uint64 public requiredPolicyId;

    /// @notice Whether PoF check is enabled
    bool public pofCheckEnabled = true;

    /// @notice Admin for configuration
    address public gatedAccessAdmin;

    // ============================================================
    // EVENTS
    // ============================================================

    event AccessGranted(bytes32 indexed holderBinding, uint64 policyId, uint64 epoch);
    event AccessDenied(bytes32 indexed holderBinding, uint64 policyId, string reason);
    event PolicyUpdated(uint64 oldPolicy, uint64 newPolicy);
    event PoFCheckToggled(bool enabled);

    // ============================================================
    // ERRORS
    // ============================================================

    error PoFRequired();
    error InvalidProof();
    error OnlyAdmin();

    // ============================================================
    // MODIFIERS
    // ============================================================

    /**
     * @notice Require valid PoF attestation
     * @param holderBinding The privacy-preserving holder identifier
     * @param proof The Merkle proof from Mina
     */
    modifier requiresPoF(
        bytes32 holderBinding,
        IZkpfMinaBridge.MinaProof calldata proof
    ) {
        if (pofCheckEnabled) {
            _checkPoF(holderBinding, proof);
        }
        _;
    }

    modifier onlyGatedAccessAdmin() {
        if (msg.sender != gatedAccessAdmin) revert OnlyAdmin();
        _;
    }

    // ============================================================
    // CONSTRUCTOR
    // ============================================================

    constructor(
        address _minaBridge,
        uint64 _requiredPolicyId,
        address _admin
    ) {
        minaBridge = IZkpfMinaBridge(_minaBridge);
        requiredPolicyId = _requiredPolicyId;
        gatedAccessAdmin = _admin;
    }

    // ============================================================
    // ADMIN FUNCTIONS
    // ============================================================

    /**
     * @notice Update the required policy ID
     */
    function setRequiredPolicyId(uint64 newPolicyId) external onlyGatedAccessAdmin {
        uint64 oldPolicy = requiredPolicyId;
        requiredPolicyId = newPolicyId;
        emit PolicyUpdated(oldPolicy, newPolicyId);
    }

    /**
     * @notice Enable or disable PoF checks
     */
    function setPoFCheckEnabled(bool enabled) external onlyGatedAccessAdmin {
        pofCheckEnabled = enabled;
        emit PoFCheckToggled(enabled);
    }

    /**
     * @notice Transfer admin role
     */
    function transferGatedAccessAdmin(address newAdmin) external onlyGatedAccessAdmin {
        gatedAccessAdmin = newAdmin;
    }

    // ============================================================
    // INTERNAL FUNCTIONS
    // ============================================================

    /**
     * @notice Internal PoF check
     */
    function _checkPoF(
        bytes32 holderBinding,
        IZkpfMinaBridge.MinaProof calldata proof
    ) internal view {
        // Use current day as epoch (could be configurable)
        uint64 epoch = uint64(block.timestamp / 1 days);

        IZkpfMinaBridge.AttestationQuery memory query = IZkpfMinaBridge.AttestationQuery({
            holderBinding: holderBinding,
            policyId: requiredPolicyId,
            epoch: epoch
        });

        bool hasValidPoF = minaBridge.hasValidPoF(query, proof);

        if (!hasValidPoF) {
            revert PoFRequired();
        }
    }

    /**
     * @notice Check PoF without reverting (for conditional logic)
     */
    function _hasValidPoF(
        bytes32 holderBinding,
        IZkpfMinaBridge.MinaProof calldata proof
    ) internal view returns (bool) {
        uint64 epoch = uint64(block.timestamp / 1 days);

        IZkpfMinaBridge.AttestationQuery memory query = IZkpfMinaBridge.AttestationQuery({
            holderBinding: holderBinding,
            policyId: requiredPolicyId,
            epoch: epoch
        });

        return minaBridge.hasValidPoF(query, proof);
    }
}

/**
 * @title ExampleGatedLending
 * @notice Example lending protocol with PoF requirements
 */
contract ExampleGatedLending is ZkpfMinaGatedAccess {
    // ============================================================
    // STATE
    // ============================================================

    /// @notice User deposits
    mapping(address => uint256) public deposits;

    /// @notice Premium tier threshold (users with PoF get better rates)
    uint256 public premiumThreshold = 1 ether;

    /// @notice Base interest rate (bps)
    uint256 public baseRate = 500; // 5%

    /// @notice Premium rate discount (bps)
    uint256 public premiumDiscount = 100; // 1% discount

    // ============================================================
    // EVENTS
    // ============================================================

    event Deposited(address indexed user, uint256 amount, bool isPremium);
    event Withdrawn(address indexed user, uint256 amount);

    // ============================================================
    // CONSTRUCTOR
    // ============================================================

    constructor(
        address _minaBridge,
        uint64 _requiredPolicyId,
        address _admin
    ) ZkpfMinaGatedAccess(_minaBridge, _requiredPolicyId, _admin) {}

    // ============================================================
    // PUBLIC FUNCTIONS
    // ============================================================

    /**
     * @notice Deposit funds (PoF not required but gives benefits)
     * @param holderBinding User's privacy-preserving identifier
     * @param proof Mina proof (can be empty for non-premium)
     */
    function deposit(
        bytes32 holderBinding,
        IZkpfMinaBridge.MinaProof calldata proof
    ) external payable {
        require(msg.value > 0, "Must deposit something");

        bool isPremium = false;
        if (proof.merkleProof.length > 0) {
            isPremium = _hasValidPoF(holderBinding, proof);
        }

        deposits[msg.sender] += msg.value;

        emit Deposited(msg.sender, msg.value, isPremium);
    }

    /**
     * @notice Access premium feature (PoF required)
     * @param holderBinding User's privacy-preserving identifier
     * @param proof Mina proof (required)
     */
    function accessPremiumFeature(
        bytes32 holderBinding,
        IZkpfMinaBridge.MinaProof calldata proof
    ) external view requiresPoF(holderBinding, proof) returns (string memory) {
        return "Welcome to premium features!";
    }

    /**
     * @notice Get effective interest rate for user
     * @param holderBinding User's privacy-preserving identifier
     * @param proof Mina proof
     */
    function getEffectiveRate(
        bytes32 holderBinding,
        IZkpfMinaBridge.MinaProof calldata proof
    ) external view returns (uint256) {
        if (proof.merkleProof.length > 0 && _hasValidPoF(holderBinding, proof)) {
            return baseRate - premiumDiscount;
        }
        return baseRate;
    }

    /**
     * @notice Withdraw deposits
     */
    function withdraw(uint256 amount) external {
        require(deposits[msg.sender] >= amount, "Insufficient balance");
        deposits[msg.sender] -= amount;
        payable(msg.sender).transfer(amount);
        emit Withdrawn(msg.sender, amount);
    }
}

