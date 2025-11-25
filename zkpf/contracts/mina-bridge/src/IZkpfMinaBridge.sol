// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/**
 * @title IZkpfMinaBridge
 * @notice Interface for zkpf Mina attestation bridge
 * @dev This interface allows DeFi protocols to check if a holder has valid
 *      proof-of-funds attestation from the Mina recursive proof hub.
 *
 * Integration example:
 * ```solidity
 * contract MyDeFiProtocol {
 *     IZkpfMinaBridge public bridge;
 *
 *     function accessRestrictedFeature(
 *         bytes32 holderBinding,
 *         uint64 policyId,
 *         bytes calldata minaProof
 *     ) external {
 *         require(
 *             bridge.hasValidPoF(
 *                 IZkpfMinaBridge.AttestationQuery(holderBinding, policyId, block.timestamp / 1 days),
 *                 minaProof
 *             ),
 *             "PoF required"
 *         );
 *         // ... restricted logic
 *     }
 * }
 * ```
 */
interface IZkpfMinaBridge {
    // ============================================================
    // STRUCTS
    // ============================================================

    /**
     * @notice Query parameters for attestation lookup
     * @param holderBinding Privacy-preserving holder identifier (H(holder_id || account_commitment))
     * @param policyId Policy that was verified (e.g., "balance >= 1 ETH")
     * @param epoch Epoch at which the proof was valid (typically day granularity)
     */
    struct AttestationQuery {
        bytes32 holderBinding;
        uint64 policyId;
        uint64 epoch;
    }

    /**
     * @notice Attestation record from Mina
     * @param holderBinding Privacy-preserving holder identifier
     * @param policyId Policy identifier
     * @param epoch Epoch when proof was created
     * @param minaSlot Mina global slot at creation
     * @param expiresAtSlot Slot when attestation expires
     * @param sourceRails Bitmask of source rails that were aggregated
     * @param isValid Whether the attestation is currently valid
     */
    struct Attestation {
        bytes32 holderBinding;
        uint64 policyId;
        uint64 epoch;
        uint64 minaSlot;
        uint64 expiresAtSlot;
        uint256 sourceRails;
        bool isValid;
    }

    /**
     * @notice Mina state proof for attestation verification
     * @param stateRoot Mina state root at the time of proof
     * @param minaSlot Global slot for the state root
     * @param attestationLeafHash Hash of the attestation leaf
     * @param merkleProof Merkle path from leaf to root
     * @param stateProof Kimchi proof of state root validity (for trustless verification)
     */
    struct MinaProof {
        bytes32 stateRoot;
        uint64 minaSlot;
        bytes32 attestationLeafHash;
        bytes32[] merkleProof;
        bytes stateProof; // Optional: for full trustless verification
    }

    // ============================================================
    // EVENTS
    // ============================================================

    /**
     * @notice Emitted when Mina state root is updated
     */
    event StateRootUpdated(
        bytes32 indexed newRoot,
        bytes32 indexed previousRoot,
        uint64 minaSlot,
        address updater
    );

    /**
     * @notice Emitted when an attestation is cached
     */
    event AttestationCached(
        bytes32 indexed attestationId,
        bytes32 indexed holderBinding,
        uint64 policyId,
        uint64 epoch
    );

    /**
     * @notice Emitted when an attestation is queried
     */
    event AttestationQueried(
        bytes32 indexed holderBinding,
        uint64 policyId,
        bool hasValidPoF
    );

    // ============================================================
    // ERRORS
    // ============================================================

    error InvalidMerkleProof();
    error StateRootTooOld();
    error AttestationExpired();
    error InvalidStateProof();
    error UnauthorizedRelayer();

    // ============================================================
    // VIEW FUNCTIONS
    // ============================================================

    /**
     * @notice Check if a holder has valid proof-of-funds attestation
     * @param query The attestation query parameters
     * @param proof Merkle proof from Mina state
     * @return True if valid attestation exists and is not expired
     */
    function hasValidPoF(
        AttestationQuery calldata query,
        MinaProof calldata proof
    ) external view returns (bool);

    /**
     * @notice Check multiple attestations in one call (gas efficient)
     * @param queries Array of attestation queries
     * @param proofs Array of corresponding proofs
     * @return Array of validity results
     */
    function hasValidPoFBatch(
        AttestationQuery[] calldata queries,
        MinaProof[] calldata proofs
    ) external view returns (bool[] memory);

    /**
     * @notice Get cached attestation (if available)
     * @param query The attestation query parameters
     * @return attestation The cached attestation record
     * @return found Whether the attestation was found in cache
     */
    function getCachedAttestation(
        AttestationQuery calldata query
    ) external view returns (Attestation memory attestation, bool found);

    /**
     * @notice Get the current trusted Mina state root
     * @return stateRoot The current state root
     * @return minaSlot The slot at which the state root was captured
     * @return lastUpdated Block timestamp of last update
     */
    function getStateRoot()
        external
        view
        returns (bytes32 stateRoot, uint64 minaSlot, uint256 lastUpdated);

    /**
     * @notice Check if a state root is considered fresh (not too old)
     * @param minaSlot The slot to check
     * @return True if the slot is within acceptable freshness window
     */
    function isStateFresh(uint64 minaSlot) external view returns (bool);

    // ============================================================
    // STATE-CHANGING FUNCTIONS
    // ============================================================

    /**
     * @notice Update the Mina state root (called by authorized relayer)
     * @param newRoot New state root from Mina
     * @param minaSlot Mina slot at which the root was captured
     * @param stateProof Optional proof of state validity
     */
    function updateStateRoot(
        bytes32 newRoot,
        uint64 minaSlot,
        bytes calldata stateProof
    ) external;

    /**
     * @notice Cache an attestation for gas-efficient future queries
     * @param attestation The attestation to cache
     * @param proof Proof of inclusion in Mina state
     */
    function cacheAttestation(
        Attestation calldata attestation,
        MinaProof calldata proof
    ) external;

    /**
     * @notice Batch cache multiple attestations
     * @param attestations Array of attestations to cache
     * @param proofs Array of corresponding proofs
     */
    function cacheAttestationBatch(
        Attestation[] calldata attestations,
        MinaProof[] calldata proofs
    ) external;
}

