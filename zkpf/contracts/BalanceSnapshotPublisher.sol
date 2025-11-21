// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/// @title BalanceSnapshotPublisher
/// @notice Publishes Merkle roots of (address, balance) snapshots for chains/assets.
/// @dev Off-chain indexers compute the Merkle tree at a given block, then publish the root here.
interface IBalanceSnapshotPublisher {
    struct Snapshot {
        bytes32 root;       // Merkle root of (address, balance) leaves
        uint64 blockNumber; // Block height for this snapshot
        uint64 timestamp;   // When this snapshot was recorded on-chain
        bool exists;
    }

    /// @dev Emitted when a new snapshot is published.
    event SnapshotPublished(
        uint64 indexed chainId,
        bytes32 indexed assetId,
        bytes32 indexed snapshotId,
        bytes32 root,
        uint64 blockNumber,
        uint64 timestamp
    );

    /// @notice Publish a new snapshot root.
    /// @dev In production, restrict this to trusted oracle roles (e.g. AccessControl).
    function publishSnapshot(
        uint64 chainId,
        bytes32 assetId,
        bytes32 snapshotId,
        bytes32 root,
        uint64 blockNumber
    ) external;

    /// @notice Fetch snapshot metadata.
    function getSnapshot(
        uint64 chainId,
        bytes32 assetId,
        bytes32 snapshotId
    ) external view returns (Snapshot memory);
}

contract BalanceSnapshotPublisher is IBalanceSnapshotPublisher {
    // chainId => assetId => snapshotId => Snapshot
    mapping(uint64 => mapping(bytes32 => mapping(bytes32 => Snapshot))) private _snapshots;

    /// @inheritdoc IBalanceSnapshotPublisher
    function publishSnapshot(
        uint64 chainId,
        bytes32 assetId,
        bytes32 snapshotId,
        bytes32 root,
        uint64 blockNumber
    ) external override {
        // NOTE: add access control (e.g. onlyRole(PUBLISHER_ROLE)) before production.
        Snapshot storage s = _snapshots[chainId][assetId][snapshotId];
        require(!s.exists, "Snapshot already exists");

        s.root = root;
        s.blockNumber = blockNumber;
        s.timestamp = uint64(block.timestamp);
        s.exists = true;

        emit SnapshotPublished(chainId, assetId, snapshotId, root, blockNumber, s.timestamp);
    }

    /// @inheritdoc IBalanceSnapshotPublisher
    function getSnapshot(
        uint64 chainId,
        bytes32 assetId,
        bytes32 snapshotId
    ) external view override returns (Snapshot memory) {
        return _snapshots[chainId][assetId][snapshotId];
    }
}


