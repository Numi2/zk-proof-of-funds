// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/// @title IAxelarGateway
/// @notice Minimal interface for Axelar Gateway contract.
/// @dev See https://docs.axelar.dev for full documentation.
interface IAxelarGateway {
    /// @notice Sends a cross-chain message to another chain.
    /// @param destinationChain The name of the destination chain (e.g., "osmosis", "ethereum").
    /// @param destinationAddress The contract address on the destination chain.
    /// @param payload The encoded message to send.
    function callContract(
        string calldata destinationChain,
        string calldata destinationAddress,
        bytes calldata payload
    ) external;

    /// @notice Validates a contract call from another chain.
    /// @param commandId The unique identifier for the command.
    /// @param sourceChain The name of the source chain.
    /// @param sourceAddress The sender's address on the source chain.
    /// @param payloadHash The keccak256 hash of the payload.
    /// @return True if the call is valid.
    function validateContractCall(
        bytes32 commandId,
        string calldata sourceChain,
        string calldata sourceAddress,
        bytes32 payloadHash
    ) external returns (bool);

    /// @notice Returns true if a command has been executed.
    function isCommandExecuted(bytes32 commandId) external view returns (bool);

    /// @notice Returns the token address for a symbol.
    function tokenAddresses(string memory symbol) external view returns (address);
}

/// @title IAxelarGasService
/// @notice Interface for paying Axelar gas fees.
interface IAxelarGasService {
    /// @notice Pay for gas for a cross-chain contract call.
    /// @param sender The address sending the message.
    /// @param destinationChain The destination chain name.
    /// @param destinationAddress The destination contract address.
    /// @param payload The message payload.
    /// @param refundAddress Address to refund excess gas to.
    function payNativeGasForContractCall(
        address sender,
        string calldata destinationChain,
        string calldata destinationAddress,
        bytes calldata payload,
        address refundAddress
    ) external payable;

    /// @notice Estimate gas fee for a cross-chain call.
    function estimateGasFee(
        string calldata destinationChain,
        string calldata destinationAddress,
        bytes calldata payload,
        uint256 gasLimit,
        bytes calldata params
    ) external view returns (uint256);
}

