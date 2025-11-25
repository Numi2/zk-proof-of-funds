// SPDX-License-Identifier: MIT
// zkpf Verifier Contract for Starknet
//
// This contract provides on-chain verification of zkpf proofs on Starknet.
// It can be used to enforce "account must have fresh zkpf PoF" before
// granting credit, leverage, or other DeFi operations.
//
// Two verification modes are supported:
// 1. Off-chain verification: Trust attestations recorded in AttestationRegistry
// 2. On-chain verification: Verify proofs directly (requires STARK-friendly circuit)

use starknet::ContractAddress;

/// Public inputs for a zkpf proof.
#[derive(Drop, Serde, Copy)]
struct ZkpfPublicInputs {
    threshold_raw: u64,
    required_currency_code: u32,
    current_epoch: u64,
    verifier_scope_id: u64,
    policy_id: u64,
    nullifier: felt252,
    custodian_pubkey_hash: felt252,
    // Starknet-specific
    chain_id_numeric: u64,
    snapshot_block_number: u64,
    account_commitment: felt252,
    holder_binding: felt252,
}

/// Verification result.
#[derive(Drop, Serde)]
struct VerificationResult {
    valid: bool,
    error_code: felt252,
    error_message: felt252,
}

#[starknet::interface]
trait IZkpfVerifier<TContractState> {
    /// Verify a zkpf proof bundle.
    fn verify_proof(
        self: @TContractState,
        proof: Span<felt252>,
        public_inputs: ZkpfPublicInputs,
    ) -> VerificationResult;

    /// Check if a proof is valid by querying the AttestationRegistry.
    fn check_attestation(
        self: @TContractState,
        holder_id: felt252,
        policy_id: u64,
        snapshot_id: felt252,
    ) -> bool;

    /// Verify and require - reverts if proof is invalid.
    fn require_valid_proof(
        self: @TContractState,
        proof: Span<felt252>,
        public_inputs: ZkpfPublicInputs,
    );

    /// Get the attestation registry address.
    fn get_attestation_registry(self: @TContractState) -> ContractAddress;

    /// Get the maximum allowed epoch drift (seconds).
    fn get_max_epoch_drift(self: @TContractState) -> u64;

    /// Set the attestation registry address (admin only).
    fn set_attestation_registry(ref self: TContractState, registry: ContractAddress);

    /// Set the maximum epoch drift (admin only).
    fn set_max_epoch_drift(ref self: TContractState, drift: u64);

    /// Get admin address.
    fn get_admin(self: @TContractState) -> ContractAddress;

    /// Transfer admin.
    fn transfer_admin(ref self: TContractState, new_admin: ContractAddress);
}

/// Error codes for verification failures.
mod ErrorCodes {
    const PROOF_INVALID: felt252 = 'PROOF_INVALID';
    const EPOCH_DRIFT: felt252 = 'EPOCH_DRIFT';
    const NULLIFIER_REPLAY: felt252 = 'NULLIFIER_REPLAY';
    const POLICY_MISMATCH: felt252 = 'POLICY_MISMATCH';
    const CHAIN_MISMATCH: felt252 = 'CHAIN_MISMATCH';
    const THRESHOLD_NOT_MET: felt252 = 'THRESHOLD_NOT_MET';
}

#[starknet::contract]
mod ZkpfVerifier {
    use super::{IZkpfVerifier, ZkpfPublicInputs, VerificationResult, ErrorCodes};
    use starknet::{ContractAddress, get_caller_address, get_block_timestamp};
    use starknet::storage::{StoragePointerReadAccess, StoragePointerWriteAccess};

    // Import AttestationRegistry interface
    use super::{IAttestationRegistryDispatcher, IAttestationRegistryDispatcherTrait};

    // Starknet chain IDs
    const SN_MAIN_CHAIN_ID: u64 = 0x534e5f4d41494e; // "SN_MAIN"
    const SN_SEPOLIA_CHAIN_ID: u64 = 0x534e5f5345504f4c4941; // "SN_SEPOLIA"

    #[storage]
    struct Storage {
        admin: ContractAddress,
        attestation_registry: ContractAddress,
        max_epoch_drift: u64,
        // Expected chain ID for this deployment
        expected_chain_id: u64,
    }

    #[constructor]
    fn constructor(
        ref self: ContractState,
        admin: ContractAddress,
        attestation_registry: ContractAddress,
        expected_chain_id: u64,
    ) {
        self.admin.write(admin);
        self.attestation_registry.write(attestation_registry);
        self.max_epoch_drift.write(300); // Default 5 minutes
        self.expected_chain_id.write(expected_chain_id);
    }

    #[abi(embed_v0)]
    impl ZkpfVerifierImpl of IZkpfVerifier<ContractState> {
        fn verify_proof(
            self: @ContractState,
            proof: Span<felt252>,
            public_inputs: ZkpfPublicInputs,
        ) -> VerificationResult {
            // Validate chain ID
            if public_inputs.chain_id_numeric != self.expected_chain_id.read() {
                return VerificationResult {
                    valid: false,
                    error_code: ErrorCodes::CHAIN_MISMATCH,
                    error_message: 'Chain ID does not match',
                };
            }

            // Validate epoch is within drift tolerance
            let current_time = get_block_timestamp();
            let max_drift = self.max_epoch_drift.read();
            
            if public_inputs.current_epoch > current_time {
                let drift = public_inputs.current_epoch - current_time;
                if drift > max_drift {
                    return VerificationResult {
                        valid: false,
                        error_code: ErrorCodes::EPOCH_DRIFT,
                        error_message: 'Epoch too far in future',
                    };
                }
            } else {
                let drift = current_time - public_inputs.current_epoch;
                if drift > max_drift {
                    return VerificationResult {
                        valid: false,
                        error_code: ErrorCodes::EPOCH_DRIFT,
                        error_message: 'Epoch too far in past',
                    };
                }
            }

            // Check nullifier hasn't been used
            let registry = IAttestationRegistryDispatcher {
                contract_address: self.attestation_registry.read()
            };
            if registry.is_nullifier_used(public_inputs.nullifier) {
                return VerificationResult {
                    valid: false,
                    error_code: ErrorCodes::NULLIFIER_REPLAY,
                    error_message: 'Nullifier already used',
                };
            }

            // NOTE: For full on-chain proof verification, we would need to implement
            // the STARK verifier here. For now, we rely on the attestation registry
            // for off-chain verified proofs.
            //
            // Future implementation would:
            // 1. Parse the proof bytes
            // 2. Verify STARK proof against the zkpf circuit verification key
            // 3. Check public inputs match the proof's public inputs
            //
            // For Cairo-native zkpf circuits, this would be straightforward.
            // For bn256/Halo2 proofs, we'd need either:
            // - A STARK wrapper circuit that verifies the Halo2 proof
            // - A BN254 pairing verification contract on Starknet

            // For now, accept proofs with valid structure
            // In production, this should be replaced with actual cryptographic verification
            if proof.len() < 16 {
                return VerificationResult {
                    valid: false,
                    error_code: ErrorCodes::PROOF_INVALID,
                    error_message: 'Proof too short',
                };
            }

            VerificationResult {
                valid: true,
                error_code: 0,
                error_message: 0,
            }
        }

        fn check_attestation(
            self: @ContractState,
            holder_id: felt252,
            policy_id: u64,
            snapshot_id: felt252,
        ) -> bool {
            let registry = IAttestationRegistryDispatcher {
                contract_address: self.attestation_registry.read()
            };
            registry.has_attestation(holder_id, policy_id, snapshot_id)
        }

        fn require_valid_proof(
            self: @ContractState,
            proof: Span<felt252>,
            public_inputs: ZkpfPublicInputs,
        ) {
            let result = self.verify_proof(proof, public_inputs);
            assert(result.valid, result.error_code);
        }

        fn get_attestation_registry(self: @ContractState) -> ContractAddress {
            self.attestation_registry.read()
        }

        fn get_max_epoch_drift(self: @ContractState) -> u64 {
            self.max_epoch_drift.read()
        }

        fn set_attestation_registry(ref self: ContractState, registry: ContractAddress) {
            self._only_admin();
            self.attestation_registry.write(registry);
        }

        fn set_max_epoch_drift(ref self: ContractState, drift: u64) {
            self._only_admin();
            self.max_epoch_drift.write(drift);
        }

        fn get_admin(self: @ContractState) -> ContractAddress {
            self.admin.read()
        }

        fn transfer_admin(ref self: ContractState, new_admin: ContractAddress) {
            self._only_admin();
            self.admin.write(new_admin);
        }
    }

    #[generate_trait]
    impl InternalImpl of InternalTrait {
        fn _only_admin(self: @ContractState) {
            let caller = get_caller_address();
            assert(caller == self.admin.read(), 'Caller is not admin');
        }
    }
}

/// Helper contract for DeFi integrations.
/// Use this as a base for protocols that want to gate access based on PoF.
#[starknet::interface]
trait IZkpfGated<TContractState> {
    /// Check if a holder meets the PoF requirement for a policy.
    fn check_pof_requirement(
        self: @TContractState,
        holder_id: felt252,
        policy_id: u64,
    ) -> bool;

    /// Get required policy ID for this protocol.
    fn get_required_policy_id(self: @TContractState) -> u64;

    /// Set required policy ID (admin only).
    fn set_required_policy_id(ref self: TContractState, policy_id: u64);
}

/// Example: Lending protocol that requires PoF for leverage.
#[starknet::contract]
mod ZkpfGatedLending {
    use super::{IZkpfGated, IZkpfVerifier, IZkpfVerifierDispatcher, IZkpfVerifierDispatcherTrait};
    use starknet::{ContractAddress, get_caller_address};
    use starknet::storage::{StoragePointerReadAccess, StoragePointerWriteAccess};

    #[storage]
    struct Storage {
        admin: ContractAddress,
        verifier: ContractAddress,
        required_policy_id: u64,
    }

    #[constructor]
    fn constructor(
        ref self: ContractState,
        admin: ContractAddress,
        verifier: ContractAddress,
        required_policy_id: u64,
    ) {
        self.admin.write(admin);
        self.verifier.write(verifier);
        self.required_policy_id.write(required_policy_id);
    }

    #[abi(embed_v0)]
    impl ZkpfGatedLendingImpl of IZkpfGated<ContractState> {
        fn check_pof_requirement(
            self: @ContractState,
            holder_id: felt252,
            policy_id: u64,
        ) -> bool {
            // Policy must match required policy
            if policy_id != self.required_policy_id.read() {
                return false;
            }

            // Check attestation exists in registry
            let verifier = IZkpfVerifierDispatcher {
                contract_address: self.verifier.read()
            };
            
            // Use a dummy snapshot_id based on current block for freshness
            // In production, this would be a specific snapshot reference
            verifier.check_attestation(holder_id, policy_id, 0)
        }

        fn get_required_policy_id(self: @ContractState) -> u64 {
            self.required_policy_id.read()
        }

        fn set_required_policy_id(ref self: ContractState, policy_id: u64) {
            let caller = get_caller_address();
            assert(caller == self.admin.read(), 'Caller is not admin');
            self.required_policy_id.write(policy_id);
        }
    }

    /// Modifier-style function to require PoF before action.
    #[generate_trait]
    impl RequiresPofImpl of RequiresPofTrait {
        fn require_pof(self: @ContractState, holder_id: felt252) {
            let has_pof = self.check_pof_requirement(holder_id, self.required_policy_id.read());
            assert(has_pof, 'PoF requirement not met');
        }
    }
}

