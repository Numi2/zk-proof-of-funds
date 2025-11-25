// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {IAxelarGateway, IAxelarGasService} from "./IAxelarGateway.sol";
import {IAttestationRegistry} from "../AttestationRegistry.sol";

/// @title AttestationBridge
/// @notice Bridges zkpf attestations to remote chains via Axelar GMP.
/// @dev When an attestation is recorded, this contract broadcasts a PoF receipt
///      to subscribed chains so dApps can trust PoF status without custom bridges.
contract AttestationBridge {
    // ═══════════════════════════════════════════════════════════════════════════
    // TYPES
    // ═══════════════════════════════════════════════════════════════════════════

    /// @notice Payload structure for PoF receipts broadcast via GMP.
    struct PoFReceipt {
        bytes32 holderId;         // Pseudonymous holder identifier
        uint256 policyId;         // Policy under which proof was verified
        bytes32 snapshotId;       // Snapshot identifier
        uint64 chainIdOrigin;     // Chain where attestation was recorded
        bytes32 attestationHash;  // Hash of the full attestation
        uint64 validityWindow;    // Seconds until receipt expires
        uint64 issuedAt;          // Timestamp when attestation was issued
    }

    /// @notice Message types for GMP payloads.
    enum MessageType {
        POF_RECEIPT,              // Standard PoF receipt
        POF_REVOCATION,           // Revoke a previous receipt
        POF_QUERY                 // Query PoF status (for pull-based integrations)
    }

    /// @notice Remote chain subscription configuration.
    struct ChainSubscription {
        string chainName;         // Axelar chain identifier (e.g., "osmosis", "neutron")
        string receiverContract;  // PoFReceiver contract address on that chain
        bool active;              // Whether subscription is active
        uint256 defaultGas;       // Default gas limit for GMP calls
    }

    // ═══════════════════════════════════════════════════════════════════════════
    // STATE
    // ═══════════════════════════════════════════════════════════════════════════

    /// @notice Reference to the Axelar Gateway contract.
    IAxelarGateway public immutable gateway;

    /// @notice Reference to the Axelar Gas Service for paying cross-chain gas.
    IAxelarGasService public immutable gasService;

    /// @notice Reference to the local AttestationRegistry.
    IAttestationRegistry public immutable attestationRegistry;

    /// @notice Chain ID of this deployment.
    uint64 public immutable originChainId;

    /// @notice Admin address for managing subscriptions.
    address public admin;

    /// @notice Default validity window for PoF receipts (seconds).
    uint64 public defaultValidityWindow = 86400; // 24 hours

    /// @notice Chain subscriptions by index.
    ChainSubscription[] public subscriptions;

    /// @notice Quick lookup: chainName => subscription index + 1 (0 = not found).
    mapping(bytes32 => uint256) public chainToIndex;

    /// @notice Whether automatic broadcasting is enabled.
    bool public autoBroadcastEnabled = true;

    // ═══════════════════════════════════════════════════════════════════════════
    // EVENTS
    // ═══════════════════════════════════════════════════════════════════════════

    event PoFBroadcast(
        bytes32 indexed holderId,
        uint256 indexed policyId,
        string destinationChain,
        bytes32 attestationHash
    );

    event ChainSubscribed(string chainName, string receiverContract);
    event ChainUnsubscribed(string chainName);
    event AdminTransferred(address indexed oldAdmin, address indexed newAdmin);
    event ValidityWindowUpdated(uint64 oldWindow, uint64 newWindow);
    event AutoBroadcastToggled(bool enabled);

    // ═══════════════════════════════════════════════════════════════════════════
    // ERRORS
    // ═══════════════════════════════════════════════════════════════════════════

    error OnlyAdmin();
    error ChainAlreadySubscribed();
    error ChainNotSubscribed();
    error InsufficientGasFee();
    error AttestationNotFound();

    // ═══════════════════════════════════════════════════════════════════════════
    // MODIFIERS
    // ═══════════════════════════════════════════════════════════════════════════

    modifier onlyAdmin() {
        if (msg.sender != admin) revert OnlyAdmin();
        _;
    }

    // ═══════════════════════════════════════════════════════════════════════════
    // CONSTRUCTOR
    // ═══════════════════════════════════════════════════════════════════════════

    /// @param _gateway Axelar Gateway contract address.
    /// @param _gasService Axelar Gas Service contract address.
    /// @param _attestationRegistry Local AttestationRegistry contract address.
    /// @param _originChainId Chain ID of this deployment (e.g., 1 for Ethereum mainnet).
    constructor(
        address _gateway,
        address _gasService,
        address _attestationRegistry,
        uint64 _originChainId
    ) {
        gateway = IAxelarGateway(_gateway);
        gasService = IAxelarGasService(_gasService);
        attestationRegistry = IAttestationRegistry(_attestationRegistry);
        originChainId = _originChainId;
        admin = msg.sender;
    }

    // ═══════════════════════════════════════════════════════════════════════════
    // ADMIN FUNCTIONS
    // ═══════════════════════════════════════════════════════════════════════════

    /// @notice Subscribe a remote chain to receive PoF broadcasts.
    /// @param chainName Axelar chain identifier.
    /// @param receiverContract PoFReceiver contract address on that chain.
    /// @param defaultGas Default gas limit for GMP calls to this chain.
    function subscribeChain(
        string calldata chainName,
        string calldata receiverContract,
        uint256 defaultGas
    ) external onlyAdmin {
        bytes32 key = keccak256(bytes(chainName));
        if (chainToIndex[key] != 0) revert ChainAlreadySubscribed();

        subscriptions.push(ChainSubscription({
            chainName: chainName,
            receiverContract: receiverContract,
            active: true,
            defaultGas: defaultGas
        }));

        chainToIndex[key] = subscriptions.length; // 1-indexed

        emit ChainSubscribed(chainName, receiverContract);
    }

    /// @notice Unsubscribe a chain from PoF broadcasts.
    /// @param chainName Axelar chain identifier.
    function unsubscribeChain(string calldata chainName) external onlyAdmin {
        bytes32 key = keccak256(bytes(chainName));
        uint256 idx = chainToIndex[key];
        if (idx == 0) revert ChainNotSubscribed();

        subscriptions[idx - 1].active = false;

        emit ChainUnsubscribed(chainName);
    }

    /// @notice Update the receiver contract for a subscribed chain.
    /// @param chainName Axelar chain identifier.
    /// @param newReceiverContract New receiver contract address.
    function updateChainReceiver(
        string calldata chainName,
        string calldata newReceiverContract
    ) external onlyAdmin {
        bytes32 key = keccak256(bytes(chainName));
        uint256 idx = chainToIndex[key];
        if (idx == 0) revert ChainNotSubscribed();

        subscriptions[idx - 1].receiverContract = newReceiverContract;
    }

    /// @notice Transfer admin role.
    /// @param newAdmin New admin address.
    function transferAdmin(address newAdmin) external onlyAdmin {
        emit AdminTransferred(admin, newAdmin);
        admin = newAdmin;
    }

    /// @notice Update the default validity window.
    /// @param newWindow New validity window in seconds.
    function setValidityWindow(uint64 newWindow) external onlyAdmin {
        emit ValidityWindowUpdated(defaultValidityWindow, newWindow);
        defaultValidityWindow = newWindow;
    }

    /// @notice Toggle automatic broadcasting.
    /// @param enabled Whether auto-broadcast is enabled.
    function setAutoBroadcast(bool enabled) external onlyAdmin {
        autoBroadcastEnabled = enabled;
        emit AutoBroadcastToggled(enabled);
    }

    // ═══════════════════════════════════════════════════════════════════════════
    // BROADCAST FUNCTIONS
    // ═══════════════════════════════════════════════════════════════════════════

    /// @notice Broadcast a PoF receipt for an existing attestation to all subscribed chains.
    /// @param attestationId The attestation ID from AttestationRegistry.
    /// @param validityWindow Override validity window (0 = use default).
    function broadcastAttestation(
        bytes32 attestationId,
        uint64 validityWindow
    ) external payable {
        IAttestationRegistry.Attestation memory att = attestationRegistry.getAttestation(attestationId);
        if (att.issuedAt == 0) revert AttestationNotFound();

        uint64 window = validityWindow > 0 ? validityWindow : defaultValidityWindow;

        PoFReceipt memory receipt = PoFReceipt({
            holderId: att.holderId,
            policyId: att.policyId,
            snapshotId: att.snapshotId,
            chainIdOrigin: originChainId,
            attestationHash: attestationId,
            validityWindow: window,
            issuedAt: att.issuedAt
        });

        _broadcastToAllChains(receipt);
    }

    /// @notice Broadcast a PoF receipt to a specific chain.
    /// @param attestationId The attestation ID from AttestationRegistry.
    /// @param destinationChain Target chain name.
    /// @param validityWindow Override validity window (0 = use default).
    function broadcastToChain(
        bytes32 attestationId,
        string calldata destinationChain,
        uint64 validityWindow
    ) external payable {
        IAttestationRegistry.Attestation memory att = attestationRegistry.getAttestation(attestationId);
        if (att.issuedAt == 0) revert AttestationNotFound();

        bytes32 key = keccak256(bytes(destinationChain));
        uint256 idx = chainToIndex[key];
        if (idx == 0) revert ChainNotSubscribed();

        ChainSubscription storage sub = subscriptions[idx - 1];
        if (!sub.active) revert ChainNotSubscribed();

        uint64 window = validityWindow > 0 ? validityWindow : defaultValidityWindow;

        PoFReceipt memory receipt = PoFReceipt({
            holderId: att.holderId,
            policyId: att.policyId,
            snapshotId: att.snapshotId,
            chainIdOrigin: originChainId,
            attestationHash: attestationId,
            validityWindow: window,
            issuedAt: att.issuedAt
        });

        _sendGMP(sub, receipt);
    }

    /// @notice Combined attest + broadcast in one transaction.
    /// @dev Requires this contract to be an authorized attestor on the registry.
    /// @param holderId Pseudonymous holder identifier.
    /// @param policyId Policy ID.
    /// @param snapshotId Snapshot identifier.
    /// @param nullifier Nullifier from zk proof.
    /// @param validityWindow Override validity window (0 = use default).
    /// @return attestationId The new attestation ID.
    function attestAndBroadcast(
        bytes32 holderId,
        uint256 policyId,
        bytes32 snapshotId,
        bytes32 nullifier,
        uint64 validityWindow
    ) external payable returns (bytes32 attestationId) {
        // Create attestation
        attestationId = attestationRegistry.attest(holderId, policyId, snapshotId, nullifier);

        // Build receipt
        uint64 window = validityWindow > 0 ? validityWindow : defaultValidityWindow;
        PoFReceipt memory receipt = PoFReceipt({
            holderId: holderId,
            policyId: policyId,
            snapshotId: snapshotId,
            chainIdOrigin: originChainId,
            attestationHash: attestationId,
            validityWindow: window,
            issuedAt: uint64(block.timestamp)
        });

        // Broadcast to all subscribed chains
        _broadcastToAllChains(receipt);
    }

    // ═══════════════════════════════════════════════════════════════════════════
    // VIEW FUNCTIONS
    // ═══════════════════════════════════════════════════════════════════════════

    /// @notice Get the number of subscribed chains.
    function subscriptionCount() external view returns (uint256) {
        return subscriptions.length;
    }

    /// @notice Get all active subscriptions.
    function getActiveSubscriptions() external view returns (ChainSubscription[] memory) {
        uint256 count = 0;
        for (uint256 i = 0; i < subscriptions.length; i++) {
            if (subscriptions[i].active) count++;
        }

        ChainSubscription[] memory active = new ChainSubscription[](count);
        uint256 j = 0;
        for (uint256 i = 0; i < subscriptions.length; i++) {
            if (subscriptions[i].active) {
                active[j++] = subscriptions[i];
            }
        }
        return active;
    }

    /// @notice Estimate total gas fee for broadcasting to all chains.
    /// @param holderId Sample holder ID for estimation.
    /// @param policyId Sample policy ID.
    function estimateBroadcastFee(
        bytes32 holderId,
        uint256 policyId
    ) external view returns (uint256 totalFee) {
        PoFReceipt memory sampleReceipt = PoFReceipt({
            holderId: holderId,
            policyId: policyId,
            snapshotId: bytes32(0),
            chainIdOrigin: originChainId,
            attestationHash: bytes32(0),
            validityWindow: defaultValidityWindow,
            issuedAt: uint64(block.timestamp)
        });

        bytes memory payload = _encodeReceipt(sampleReceipt);

        for (uint256 i = 0; i < subscriptions.length; i++) {
            if (subscriptions[i].active) {
                totalFee += gasService.estimateGasFee(
                    subscriptions[i].chainName,
                    subscriptions[i].receiverContract,
                    payload,
                    subscriptions[i].defaultGas,
                    ""
                );
            }
        }
    }

    // ═══════════════════════════════════════════════════════════════════════════
    // INTERNAL FUNCTIONS
    // ═══════════════════════════════════════════════════════════════════════════

    /// @notice Broadcast a receipt to all active subscribed chains.
    function _broadcastToAllChains(PoFReceipt memory receipt) internal {
        uint256 gasPerChain = msg.value / _countActiveChains();

        for (uint256 i = 0; i < subscriptions.length; i++) {
            if (subscriptions[i].active) {
                _sendGMPWithValue(subscriptions[i], receipt, gasPerChain);
            }
        }
    }

    /// @notice Send GMP message to a specific chain.
    function _sendGMP(ChainSubscription storage sub, PoFReceipt memory receipt) internal {
        bytes memory payload = _encodeReceipt(receipt);

        // Pay gas if value provided
        if (msg.value > 0) {
            gasService.payNativeGasForContractCall{value: msg.value}(
                address(this),
                sub.chainName,
                sub.receiverContract,
                payload,
                msg.sender
            );
        }

        // Send the GMP message
        gateway.callContract(
            sub.chainName,
            sub.receiverContract,
            payload
        );

        emit PoFBroadcast(
            receipt.holderId,
            receipt.policyId,
            sub.chainName,
            receipt.attestationHash
        );
    }

    /// @notice Send GMP message with specific gas value.
    function _sendGMPWithValue(
        ChainSubscription storage sub,
        PoFReceipt memory receipt,
        uint256 gasValue
    ) internal {
        bytes memory payload = _encodeReceipt(receipt);

        // Pay gas
        if (gasValue > 0) {
            gasService.payNativeGasForContractCall{value: gasValue}(
                address(this),
                sub.chainName,
                sub.receiverContract,
                payload,
                msg.sender
            );
        }

        // Send the GMP message
        gateway.callContract(
            sub.chainName,
            sub.receiverContract,
            payload
        );

        emit PoFBroadcast(
            receipt.holderId,
            receipt.policyId,
            sub.chainName,
            receipt.attestationHash
        );
    }

    /// @notice Encode a PoF receipt for GMP transmission.
    function _encodeReceipt(PoFReceipt memory receipt) internal pure returns (bytes memory) {
        return abi.encode(
            uint8(MessageType.POF_RECEIPT),
            receipt.holderId,
            receipt.policyId,
            receipt.snapshotId,
            receipt.chainIdOrigin,
            receipt.attestationHash,
            receipt.validityWindow,
            receipt.issuedAt
        );
    }

    /// @notice Count active subscribed chains.
    function _countActiveChains() internal view returns (uint256 count) {
        for (uint256 i = 0; i < subscriptions.length; i++) {
            if (subscriptions[i].active) count++;
        }
        if (count == 0) count = 1; // Prevent division by zero
    }
}

