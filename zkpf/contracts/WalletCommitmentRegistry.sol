// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/// @title WalletCommitmentRegistry
/// @notice Registry of wallet commitments per pseudonymous holderId.
/// @dev Each commitment C = H(s, walletAddress, holderId, ...) is computed off-chain.
///      The contract never sees raw wallet addresses; it only stores commitments.
interface IWalletCommitmentRegistry {
    /// @dev Emitted when a new commitment is registered for a holder.
    event CommitmentRegistered(
        bytes32 indexed holderId,
        bytes32 indexed commitment,
        address indexed registrar
    );

    /// @dev Emitted when the commitment count for a holder increases.
    event HolderIncremented(bytes32 indexed holderId, uint256 newCount);

    /// @notice Register a new wallet commitment for a holder.
    /// @param holderId A pseudonymous identifier (e.g. hash of KYC record, DID, or bank-scope ID).
    /// @param commitment Commitment C = H(s, walletAddress, holderId, ...).
    function registerCommitment(bytes32 holderId, bytes32 commitment) external;

    /// @notice Number of commitments currently registered for a holder.
    function commitmentCount(bytes32 holderId) external view returns (uint256);

    /// @notice Retrieve a commitment by index for a holder.
    /// @dev Intended for off-chain Merkle tree construction and audits.
    function getCommitment(bytes32 holderId, uint256 index) external view returns (bytes32);
}

contract WalletCommitmentRegistry is IWalletCommitmentRegistry {
    // holderId => list of commitments
    mapping(bytes32 => bytes32[]) private _commitments;

    /// @inheritdoc IWalletCommitmentRegistry
    function registerCommitment(bytes32 holderId, bytes32 commitment) external override {
        _commitments[holderId].push(commitment);
        emit CommitmentRegistered(holderId, commitment, msg.sender);
        emit HolderIncremented(holderId, _commitments[holderId].length);
    }

    /// @inheritdoc IWalletCommitmentRegistry
    function commitmentCount(bytes32 holderId) external view override returns (uint256) {
        return _commitments[holderId].length;
    }

    /// @inheritdoc IWalletCommitmentRegistry
    function getCommitment(bytes32 holderId, uint256 index) external view override returns (bytes32) {
        return _commitments[holderId][index];
    }
}


