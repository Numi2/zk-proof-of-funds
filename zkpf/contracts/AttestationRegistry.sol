// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/// @title AttestationRegistry
/// @notice Minimal registry of zk proof-of-funds attestations.
/// @dev Intended to be called by trusted verifiers / banks after off-chain verification succeeds.
interface IAttestationRegistry {
    struct Attestation {
        bytes32 holderId;   // Pseudonymous holder identifier
        uint256 policyId;   // Policy under which the proof was checked (threshold, scope, etc.)
        bytes32 snapshotId; // Snapshot identifier from BalanceSnapshotPublisher
        bytes32 nullifier;  // Nullifier from zk public inputs (prevents certain reuses)
        uint64 issuedAt;    // Block timestamp when attestation was recorded
        address attestor;   // Who recorded this attestation (bank, verifier service, etc.)
    }

    /// @dev Emitted whenever an attestation is recorded.
    event Attested(
        bytes32 indexed attestationId,
        bytes32 indexed holderId,
        uint256 indexed policyId,
        bytes32 snapshotId,
        bytes32 nullifier,
        address attestor
    );

    /// @notice Record a new attestation.
    /// @dev In production, restrict to authorized verifiers via AccessControl/roles.
    function attest(
        bytes32 holderId,
        uint256 policyId,
        bytes32 snapshotId,
        bytes32 nullifier
    ) external returns (bytes32 attestationId);

    /// @notice Fetch an attestation by ID.
    function getAttestation(bytes32 attestationId) external view returns (Attestation memory);

    /// @notice Quick check: do we have any attestation for this holder/policy/snapshot?
    function hasAttestation(
        bytes32 holderId,
        uint256 policyId,
        bytes32 snapshotId
    ) external view returns (bool);
}

contract AttestationRegistry is IAttestationRegistry {
    mapping(bytes32 => Attestation) private _attestations;
    // holderId => policyId => snapshotId => exists
    mapping(bytes32 => mapping(uint256 => mapping(bytes32 => bool))) private _exists;

    /// @inheritdoc IAttestationRegistry
    function attest(
        bytes32 holderId,
        uint256 policyId,
        bytes32 snapshotId,
        bytes32 nullifier
    ) external override returns (bytes32 attestationId) {
        // NOTE: add access control before production (e.g. onlyRole(VERIFIER_ROLE)).
        attestationId = keccak256(
            abi.encodePacked(holderId, policyId, snapshotId, nullifier, msg.sender, block.timestamp)
        );
        require(_attestations[attestationId].issuedAt == 0, "Attestation already exists");

        Attestation memory a = Attestation({
            holderId: holderId,
            policyId: policyId,
            snapshotId: snapshotId,
            nullifier: nullifier,
            issuedAt: uint64(block.timestamp),
            attestor: msg.sender
        });

        _attestations[attestationId] = a;
        _exists[holderId][policyId][snapshotId] = true;

        emit Attested(attestationId, holderId, policyId, snapshotId, nullifier, msg.sender);
    }

    /// @inheritdoc IAttestationRegistry
    function getAttestation(bytes32 attestationId) external view override returns (Attestation memory) {
        return _attestations[attestationId];
    }

    /// @inheritdoc IAttestationRegistry
    function hasAttestation(
        bytes32 holderId,
        uint256 policyId,
        bytes32 snapshotId
    ) external view override returns (bool) {
        return _exists[holderId][policyId][snapshotId];
    }
}


