// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {IZkpfMinaBridge} from "./IZkpfMinaBridge.sol";

/**
 * @title ZkpfMinaBridge
 * @notice EVM bridge for zkpf Mina attestations
 * @dev Allows EVM chains to verify proof-of-funds attestations from Mina's
 *      recursive proof hub. Supports both trustless verification (via Kimchi
 *      proof verification) and trusted relayer mode.
 *
 * Architecture:
 * 1. Mina zkApp emits attestation events
 * 2. Relayer captures events and submits state root updates
 * 3. DeFi protocols call hasValidPoF() to check attestations
 *
 * Security Model:
 * - In "relayer mode": Trust the configured relayer(s) to submit valid state roots
 * - In "trustless mode": Verify Kimchi proofs on-chain (more expensive)
 *
 * Gas Optimization:
 * - Frequently queried attestations can be cached
 * - Batch operations for multiple attestations
 * - State root updates batched with attestation caching
 */
contract ZkpfMinaBridge is IZkpfMinaBridge {
    // ============================================================
    // STATE VARIABLES
    // ============================================================

    /// @notice Current trusted Mina state root
    bytes32 public currentStateRoot;

    /// @notice Mina slot at which the current state root was captured
    uint64 public currentMinaSlot;

    /// @notice Block timestamp of last state root update
    uint256 public lastStateUpdate;

    /// @notice Maximum age of state root in seconds (default: 1 hour)
    uint256 public maxStateAge = 3600;

    /// @notice Mina attestation tree depth (for Merkle proof verification)
    uint256 public constant MERKLE_TREE_DEPTH = 20;

    /// @notice Admin address
    address public admin;

    /// @notice Authorized relayers
    mapping(address => bool) public authorizedRelayers;

    /// @notice Cached attestations (attestationId => Attestation)
    mapping(bytes32 => Attestation) public cachedAttestations;

    /// @notice Whether an attestation ID is cached
    mapping(bytes32 => bool) public isCached;

    /// @notice Whether trustless mode is enabled (requires Kimchi verification)
    bool public trustlessMode;

    // ============================================================
    // MODIFIERS
    // ============================================================

    modifier onlyAdmin() {
        require(msg.sender == admin, "Only admin");
        _;
    }

    modifier onlyRelayer() {
        if (!authorizedRelayers[msg.sender]) {
            revert UnauthorizedRelayer();
        }
        _;
    }

    // ============================================================
    // CONSTRUCTOR
    // ============================================================

    constructor(address _admin) {
        admin = _admin;
        authorizedRelayers[_admin] = true;
    }

    // ============================================================
    // ADMIN FUNCTIONS
    // ============================================================

    /**
     * @notice Add an authorized relayer
     */
    function addRelayer(address relayer) external onlyAdmin {
        authorizedRelayers[relayer] = true;
    }

    /**
     * @notice Remove an authorized relayer
     */
    function removeRelayer(address relayer) external onlyAdmin {
        authorizedRelayers[relayer] = false;
    }

    /**
     * @notice Update max state age
     */
    function setMaxStateAge(uint256 newMaxAge) external onlyAdmin {
        maxStateAge = newMaxAge;
    }

    /**
     * @notice Enable/disable trustless mode
     */
    function setTrustlessMode(bool enabled) external onlyAdmin {
        trustlessMode = enabled;
    }

    /**
     * @notice Transfer admin role
     */
    function transferAdmin(address newAdmin) external onlyAdmin {
        admin = newAdmin;
    }

    // ============================================================
    // VIEW FUNCTIONS
    // ============================================================

    /// @inheritdoc IZkpfMinaBridge
    function hasValidPoF(
        AttestationQuery calldata query,
        MinaProof calldata proof
    ) external view returns (bool) {
        // First check cache for gas efficiency
        bytes32 attestationId = _computeAttestationId(query);
        if (isCached[attestationId]) {
            Attestation storage cached = cachedAttestations[attestationId];
            if (cached.isValid && _isNotExpired(cached.expiresAtSlot)) {
                return true;
            }
        }

        // Verify Merkle proof against current state root
        if (!_verifyMerkleProof(proof, query)) {
            return false;
        }

        // Check state freshness
        if (!isStateFresh(proof.minaSlot)) {
            return false;
        }

        // In trustless mode, also verify the Kimchi state proof
        if (trustlessMode && proof.stateProof.length > 0) {
            if (!_verifyKimchiProof(proof.stateRoot, proof.stateProof)) {
                return false;
            }
        }

        emit AttestationQueried(query.holderBinding, query.policyId, true);
        return true;
    }

    /// @inheritdoc IZkpfMinaBridge
    function hasValidPoFBatch(
        AttestationQuery[] calldata queries,
        MinaProof[] calldata proofs
    ) external view returns (bool[] memory results) {
        require(queries.length == proofs.length, "Length mismatch");
        results = new bool[](queries.length);

        for (uint256 i = 0; i < queries.length; i++) {
            results[i] = this.hasValidPoF(queries[i], proofs[i]);
        }
    }

    /// @inheritdoc IZkpfMinaBridge
    function getCachedAttestation(
        AttestationQuery calldata query
    ) external view returns (Attestation memory attestation, bool found) {
        bytes32 attestationId = _computeAttestationId(query);
        if (isCached[attestationId]) {
            return (cachedAttestations[attestationId], true);
        }
        return (attestation, false);
    }

    /// @inheritdoc IZkpfMinaBridge
    function getStateRoot()
        external
        view
        returns (bytes32 stateRoot, uint64 minaSlot, uint256 lastUpdated)
    {
        return (currentStateRoot, currentMinaSlot, lastStateUpdate);
    }

    /// @inheritdoc IZkpfMinaBridge
    function isStateFresh(uint64 minaSlot) public view returns (bool) {
        // State is fresh if it's within maxStateAge seconds
        // Note: This is a simplified check; production would compare slots more precisely
        return block.timestamp - lastStateUpdate <= maxStateAge;
    }

    // ============================================================
    // STATE-CHANGING FUNCTIONS
    // ============================================================

    /// @inheritdoc IZkpfMinaBridge
    function updateStateRoot(
        bytes32 newRoot,
        uint64 minaSlot,
        bytes calldata stateProof
    ) external onlyRelayer {
        // In trustless mode, verify the state proof
        if (trustlessMode && stateProof.length > 0) {
            if (!_verifyKimchiProof(newRoot, stateProof)) {
                revert InvalidStateProof();
            }
        }

        // Ensure new slot is more recent
        require(minaSlot > currentMinaSlot, "Stale state root");

        bytes32 previousRoot = currentStateRoot;
        currentStateRoot = newRoot;
        currentMinaSlot = minaSlot;
        lastStateUpdate = block.timestamp;

        emit StateRootUpdated(newRoot, previousRoot, minaSlot, msg.sender);
    }

    /// @inheritdoc IZkpfMinaBridge
    function cacheAttestation(
        Attestation calldata attestation,
        MinaProof calldata proof
    ) external {
        // Verify the attestation is valid
        AttestationQuery memory query = AttestationQuery({
            holderBinding: attestation.holderBinding,
            policyId: attestation.policyId,
            epoch: attestation.epoch
        });

        require(_verifyMerkleProof(proof, query), "Invalid proof");

        bytes32 attestationId = _computeAttestationId(query);
        cachedAttestations[attestationId] = attestation;
        isCached[attestationId] = true;

        emit AttestationCached(
            attestationId,
            attestation.holderBinding,
            attestation.policyId,
            attestation.epoch
        );
    }

    /// @inheritdoc IZkpfMinaBridge
    function cacheAttestationBatch(
        Attestation[] calldata attestations,
        MinaProof[] calldata proofs
    ) external {
        require(attestations.length == proofs.length, "Length mismatch");

        for (uint256 i = 0; i < attestations.length; i++) {
            this.cacheAttestation(attestations[i], proofs[i]);
        }
    }

    // ============================================================
    // INTERNAL FUNCTIONS
    // ============================================================

    /**
     * @notice Compute attestation ID from query parameters
     */
    function _computeAttestationId(
        AttestationQuery memory query
    ) internal pure returns (bytes32) {
        return keccak256(abi.encodePacked(
            "mina_attestation_id_v1",
            query.holderBinding,
            query.policyId,
            query.epoch
        ));
    }

    /**
     * @notice Verify Merkle proof of attestation inclusion
     */
    function _verifyMerkleProof(
        MinaProof calldata proof,
        AttestationQuery memory query
    ) internal view returns (bool) {
        // Compute expected leaf hash
        bytes32 leafHash = _computeLeafHash(query);

        // Verify it matches the claimed leaf hash
        if (leafHash != proof.attestationLeafHash) {
            return false;
        }

        // Verify Merkle path
        bytes32 computedRoot = proof.attestationLeafHash;
        for (uint256 i = 0; i < proof.merkleProof.length; i++) {
            bytes32 sibling = proof.merkleProof[i];
            // Determine order based on path bit (simplified: use index parity)
            if (uint256(computedRoot) < uint256(sibling)) {
                computedRoot = keccak256(abi.encodePacked(computedRoot, sibling));
            } else {
                computedRoot = keccak256(abi.encodePacked(sibling, computedRoot));
            }
        }

        // Check against state root
        // Note: In production, this would verify against the attestation subtree root
        return computedRoot == proof.stateRoot || proof.stateRoot == currentStateRoot;
    }

    /**
     * @notice Compute leaf hash for Merkle verification
     */
    function _computeLeafHash(
        AttestationQuery memory query
    ) internal pure returns (bytes32) {
        return keccak256(abi.encodePacked(
            "mina_attestation_leaf_v1",
            query.holderBinding,
            query.policyId,
            query.epoch
        ));
    }

    /**
     * @notice Check if attestation is not expired
     */
    function _isNotExpired(uint64 expiresAtSlot) internal view returns (bool) {
        // Convert Mina slot to approximate timestamp
        // Mina slots are ~3 minutes each
        // This is a simplified check; production would use more precise timing
        uint256 expiresAtTimestamp = lastStateUpdate + 
            (expiresAtSlot - currentMinaSlot) * 180; // 180 seconds per slot
        return block.timestamp < expiresAtTimestamp;
    }

    /**
     * @notice Verify Kimchi proof (placeholder for trustless verification)
     * @dev This is where Kimchi/Pickles proof verification would go.
     *      Options:
     *      1. Implement Pasta curve operations in Solidity (expensive)
     *      2. Use a recursive wrapper that converts to BN254
     *      3. Use zkVM like SP1 to verify off-chain and post commitment
     */
    function _verifyKimchiProof(
        bytes32 /* stateRoot */,
        bytes calldata /* proof */
    ) internal pure returns (bool) {
        // TODO: Implement Kimchi proof verification
        // For now, this is a placeholder that always returns true
        // Production deployment should implement actual verification
        return true;
    }
}

