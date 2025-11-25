// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {IAxelarGateway} from "./IAxelarGateway.sol";

/// @title PoFReceiver
/// @notice Receives PoF receipts via Axelar GMP on remote chains.
/// @dev Deploy this contract on chains where dApps need to check zkpf PoF status
///      without running their own verification infrastructure.
contract PoFReceiver {
    // ═══════════════════════════════════════════════════════════════════════════
    // TYPES
    // ═══════════════════════════════════════════════════════════════════════════

    /// @notice Stored PoF receipt.
    struct StoredReceipt {
        bytes32 holderId;         // Pseudonymous holder identifier
        uint256 policyId;         // Policy under which proof was verified
        bytes32 snapshotId;       // Snapshot identifier
        uint64 chainIdOrigin;     // Chain where attestation was recorded
        bytes32 attestationHash;  // Hash of the full attestation on origin chain
        uint64 issuedAt;          // Timestamp when attestation was issued
        uint64 expiresAt;         // Timestamp when receipt expires
        bool valid;               // Whether receipt is currently valid
    }

    /// @notice Message types for GMP payloads.
    enum MessageType {
        POF_RECEIPT,
        POF_REVOCATION,
        POF_QUERY
    }

    /// @notice Trusted source configuration.
    struct TrustedSource {
        string chainName;
        string bridgeContract;
        bool active;
    }

    // ═══════════════════════════════════════════════════════════════════════════
    // STATE
    // ═══════════════════════════════════════════════════════════════════════════

    /// @notice Reference to the Axelar Gateway contract.
    IAxelarGateway public immutable gateway;

    /// @notice Admin address.
    address public admin;

    /// @notice Trusted source bridges by chain name hash.
    mapping(bytes32 => TrustedSource) public trustedSources;

    /// @notice Array of trusted chain names for enumeration.
    string[] public trustedChains;

    /// @notice Stored receipts by (holderId, policyId, snapshotId) hash.
    mapping(bytes32 => StoredReceipt) public receipts;

    /// @notice Quick lookup: holderId => active policyIds.
    mapping(bytes32 => uint256[]) public holderPolicies;

    /// @notice Lookup: (holderId, policyId) => latest snapshotId.
    mapping(bytes32 => bytes32) public latestSnapshot;

    /// @notice Whether to allow expired receipts to be queried (for historical lookups).
    bool public keepExpiredReceipts = true;

    // ═══════════════════════════════════════════════════════════════════════════
    // EVENTS
    // ═══════════════════════════════════════════════════════════════════════════

    event PoFReceived(
        bytes32 indexed holderId,
        uint256 indexed policyId,
        bytes32 snapshotId,
        uint64 chainIdOrigin,
        bytes32 attestationHash,
        uint64 expiresAt
    );

    event PoFRevoked(
        bytes32 indexed holderId,
        uint256 indexed policyId,
        bytes32 snapshotId
    );

    event TrustedSourceAdded(string chainName, string bridgeContract);
    event TrustedSourceRemoved(string chainName);
    event AdminTransferred(address indexed oldAdmin, address indexed newAdmin);

    // ═══════════════════════════════════════════════════════════════════════════
    // ERRORS
    // ═══════════════════════════════════════════════════════════════════════════

    error OnlyAdmin();
    error OnlyGateway();
    error UntrustedSource();
    error InvalidPayload();
    error InvalidMessageType();

    // ═══════════════════════════════════════════════════════════════════════════
    // MODIFIERS
    // ═══════════════════════════════════════════════════════════════════════════

    modifier onlyAdmin() {
        if (msg.sender != admin) revert OnlyAdmin();
        _;
    }

    modifier onlyGateway() {
        if (msg.sender != address(gateway)) revert OnlyGateway();
        _;
    }

    // ═══════════════════════════════════════════════════════════════════════════
    // CONSTRUCTOR
    // ═══════════════════════════════════════════════════════════════════════════

    /// @param _gateway Axelar Gateway contract address on this chain.
    constructor(address _gateway) {
        gateway = IAxelarGateway(_gateway);
        admin = msg.sender;
    }

    // ═══════════════════════════════════════════════════════════════════════════
    // ADMIN FUNCTIONS
    // ═══════════════════════════════════════════════════════════════════════════

    /// @notice Add a trusted source bridge.
    /// @param chainName Axelar chain identifier (e.g., "ethereum", "arbitrum").
    /// @param bridgeContract AttestationBridge contract address on that chain.
    function addTrustedSource(
        string calldata chainName,
        string calldata bridgeContract
    ) external onlyAdmin {
        bytes32 key = keccak256(bytes(chainName));
        trustedSources[key] = TrustedSource({
            chainName: chainName,
            bridgeContract: bridgeContract,
            active: true
        });
        trustedChains.push(chainName);

        emit TrustedSourceAdded(chainName, bridgeContract);
    }

    /// @notice Remove a trusted source.
    /// @param chainName Axelar chain identifier.
    function removeTrustedSource(string calldata chainName) external onlyAdmin {
        bytes32 key = keccak256(bytes(chainName));
        trustedSources[key].active = false;

        emit TrustedSourceRemoved(chainName);
    }

    /// @notice Transfer admin role.
    /// @param newAdmin New admin address.
    function transferAdmin(address newAdmin) external onlyAdmin {
        emit AdminTransferred(admin, newAdmin);
        admin = newAdmin;
    }

    /// @notice Set whether to keep expired receipts.
    function setKeepExpiredReceipts(bool keep) external onlyAdmin {
        keepExpiredReceipts = keep;
    }

    // ═══════════════════════════════════════════════════════════════════════════
    // AXELAR EXECUTABLE
    // ═══════════════════════════════════════════════════════════════════════════

    /// @notice Execute a cross-chain contract call from Axelar.
    /// @dev Called by the Axelar Gateway after validating the source.
    /// @param commandId Unique command identifier.
    /// @param sourceChain The source chain name.
    /// @param sourceAddress The sender's address on the source chain.
    /// @param payload The encoded message.
    function execute(
        bytes32 commandId,
        string calldata sourceChain,
        string calldata sourceAddress,
        bytes calldata payload
    ) external {
        // Validate the call came from Axelar Gateway
        bytes32 payloadHash = keccak256(payload);
        if (!gateway.validateContractCall(commandId, sourceChain, sourceAddress, payloadHash)) {
            revert UntrustedSource();
        }

        // Validate the source is trusted
        bytes32 chainKey = keccak256(bytes(sourceChain));
        TrustedSource storage source = trustedSources[chainKey];
        if (!source.active) revert UntrustedSource();

        // Verify source address matches trusted bridge
        if (keccak256(bytes(source.bridgeContract)) != keccak256(bytes(sourceAddress))) {
            revert UntrustedSource();
        }

        // Decode and process the message
        _processPayload(payload);
    }

    // ═══════════════════════════════════════════════════════════════════════════
    // QUERY FUNCTIONS
    // ═══════════════════════════════════════════════════════════════════════════

    /// @notice Check if a holder has valid PoF for a specific policy.
    /// @param holderId Pseudonymous holder identifier.
    /// @param policyId Policy ID to check.
    /// @return hasPoF True if holder has valid (non-expired) PoF.
    /// @return receipt The stored receipt (if any).
    function checkPoF(
        bytes32 holderId,
        uint256 policyId
    ) external view returns (bool hasPoF, StoredReceipt memory receipt) {
        bytes32 hpKey = _holderPolicyKey(holderId, policyId);
        bytes32 snapshotId = latestSnapshot[hpKey];

        if (snapshotId == bytes32(0)) {
            return (false, receipt);
        }

        bytes32 receiptKey = _receiptKey(holderId, policyId, snapshotId);
        receipt = receipts[receiptKey];

        hasPoF = receipt.valid && block.timestamp < receipt.expiresAt;
    }

    /// @notice Check if a holder has PoF for a specific policy and snapshot.
    /// @param holderId Pseudonymous holder identifier.
    /// @param policyId Policy ID.
    /// @param snapshotId Snapshot identifier.
    /// @return hasPoF True if holder has valid PoF for this exact snapshot.
    function hasPoFForSnapshot(
        bytes32 holderId,
        uint256 policyId,
        bytes32 snapshotId
    ) external view returns (bool hasPoF) {
        bytes32 receiptKey = _receiptKey(holderId, policyId, snapshotId);
        StoredReceipt storage receipt = receipts[receiptKey];

        hasPoF = receipt.valid && block.timestamp < receipt.expiresAt;
    }

    /// @notice Get all policy IDs for which a holder has PoF records.
    /// @param holderId Pseudonymous holder identifier.
    /// @return policyIds Array of policy IDs with PoF records.
    function getHolderPolicies(bytes32 holderId) external view returns (uint256[] memory) {
        return holderPolicies[holderId];
    }

    /// @notice Get a specific receipt by its components.
    /// @param holderId Pseudonymous holder identifier.
    /// @param policyId Policy ID.
    /// @param snapshotId Snapshot identifier.
    /// @return receipt The stored receipt.
    function getReceipt(
        bytes32 holderId,
        uint256 policyId,
        bytes32 snapshotId
    ) external view returns (StoredReceipt memory) {
        bytes32 receiptKey = _receiptKey(holderId, policyId, snapshotId);
        return receipts[receiptKey];
    }

    /// @notice Get the latest receipt for a holder/policy pair.
    /// @param holderId Pseudonymous holder identifier.
    /// @param policyId Policy ID.
    /// @return receipt The latest stored receipt.
    function getLatestReceipt(
        bytes32 holderId,
        uint256 policyId
    ) external view returns (StoredReceipt memory) {
        bytes32 hpKey = _holderPolicyKey(holderId, policyId);
        bytes32 snapshotId = latestSnapshot[hpKey];

        if (snapshotId == bytes32(0)) {
            return StoredReceipt({
                holderId: bytes32(0),
                policyId: 0,
                snapshotId: bytes32(0),
                chainIdOrigin: 0,
                attestationHash: bytes32(0),
                issuedAt: 0,
                expiresAt: 0,
                valid: false
            });
        }

        bytes32 receiptKey = _receiptKey(holderId, policyId, snapshotId);
        return receipts[receiptKey];
    }

    /// @notice Get the number of trusted source chains.
    function trustedChainCount() external view returns (uint256) {
        return trustedChains.length;
    }

    // ═══════════════════════════════════════════════════════════════════════════
    // INTERNAL FUNCTIONS
    // ═══════════════════════════════════════════════════════════════════════════

    /// @notice Process a decoded GMP payload.
    function _processPayload(bytes calldata payload) internal {
        // Decode message type
        uint8 msgType = abi.decode(payload, (uint8));

        if (msgType == uint8(MessageType.POF_RECEIPT)) {
            _handleReceipt(payload);
        } else if (msgType == uint8(MessageType.POF_REVOCATION)) {
            _handleRevocation(payload);
        } else {
            revert InvalidMessageType();
        }
    }

    /// @notice Handle a PoF receipt message.
    function _handleReceipt(bytes calldata payload) internal {
        (
            /* msgType */,
            bytes32 holderId,
            uint256 policyId,
            bytes32 snapshotId,
            uint64 chainIdOrigin,
            bytes32 attestationHash,
            uint64 validityWindow,
            uint64 issuedAt
        ) = abi.decode(payload, (uint8, bytes32, uint256, bytes32, uint64, bytes32, uint64, uint64));

        // Compute expiry
        uint64 expiresAt = issuedAt + validityWindow;

        // Store the receipt
        bytes32 receiptKey = _receiptKey(holderId, policyId, snapshotId);
        receipts[receiptKey] = StoredReceipt({
            holderId: holderId,
            policyId: policyId,
            snapshotId: snapshotId,
            chainIdOrigin: chainIdOrigin,
            attestationHash: attestationHash,
            issuedAt: issuedAt,
            expiresAt: expiresAt,
            valid: true
        });

        // Update latest snapshot
        bytes32 hpKey = _holderPolicyKey(holderId, policyId);
        bytes32 prevSnapshot = latestSnapshot[hpKey];
        if (prevSnapshot == bytes32(0)) {
            // First receipt for this holder/policy
            holderPolicies[holderId].push(policyId);
        }
        latestSnapshot[hpKey] = snapshotId;

        emit PoFReceived(
            holderId,
            policyId,
            snapshotId,
            chainIdOrigin,
            attestationHash,
            expiresAt
        );
    }

    /// @notice Handle a PoF revocation message.
    function _handleRevocation(bytes calldata payload) internal {
        (
            /* msgType */,
            bytes32 holderId,
            uint256 policyId,
            bytes32 snapshotId
        ) = abi.decode(payload, (uint8, bytes32, uint256, bytes32));

        bytes32 receiptKey = _receiptKey(holderId, policyId, snapshotId);
        receipts[receiptKey].valid = false;

        emit PoFRevoked(holderId, policyId, snapshotId);
    }

    /// @notice Compute the storage key for a receipt.
    function _receiptKey(
        bytes32 holderId,
        uint256 policyId,
        bytes32 snapshotId
    ) internal pure returns (bytes32) {
        return keccak256(abi.encodePacked(holderId, policyId, snapshotId));
    }

    /// @notice Compute the storage key for holder/policy lookups.
    function _holderPolicyKey(
        bytes32 holderId,
        uint256 policyId
    ) internal pure returns (bytes32) {
        return keccak256(abi.encodePacked(holderId, policyId));
    }
}

