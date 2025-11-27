// SPDX-License-Identifier: MIT
// MinaStateVerifier - Mina Cross-Chain Attestation Verifier for Starknet
//
// This contract enables Starknet DeFi protocols to gate features based on
// proof-of-funds verified on the Mina Protocol via the zkpf recursive proof hub.
//
// Flow:
// 1. User generates Starknet PoF proof (or any zkpf-supported rail)
// 2. Proof is wrapped into Mina recursive proof via zkpf-mina
// 3. Attestation is bridged to Starknet via relayer
// 4. Starknet DeFi protocols query this contract to check cross-chain PoF
//
// This enables:
// - Cross-chain proof aggregation (prove reserves across multiple chains)
// - Privacy-preserving compliance (holder binding, not actual addresses)
// - Efficient verification (check attestation bit, not full proof)

use starknet::ContractAddress;

/// Mina attestation record stored on-chain.
#[derive(Drop, Serde, starknet::Store, Copy)]
pub struct MinaAttestation {
    /// Mina digest: H(bridge_tip || state_hashes || ledger_hashes)
    pub mina_digest: felt252,
    /// Holder binding (privacy-preserving identifier)
    pub holder_binding: felt252,
    /// Policy ID from zkpf
    pub policy_id: u64,
    /// Epoch at attestation time
    pub epoch: u64,
    /// Mina slot at attestation time
    pub mina_slot: u64,
    /// Expiration Mina slot (validity window)
    pub expires_at_slot: u64,
    /// Source rails that were aggregated (as bitmask)
    /// Bit 0: CUSTODIAL
    /// Bit 1: ORCHARD (Zcash)
    /// Bit 2: STARKNET_L2
    /// Bit 3: MINA_NATIVE
    pub source_rails_mask: u8,
    /// Unix timestamp when bridged to Starknet
    pub bridged_at: u64,
    /// Relayer that submitted the attestation
    pub relayer: ContractAddress,
    /// Is the attestation still valid
    pub is_valid: bool,
}

/// Source rail identifiers (bit positions in source_rails_mask).
pub mod SourceRails {
    pub const CUSTODIAL: u8 = 0;
    pub const ORCHARD: u8 = 1;
    pub const STARKNET_L2: u8 = 2;
    pub const MINA_NATIVE: u8 = 3;
}

/// Bridge message types.
#[derive(Drop, Serde, Copy, PartialEq)]
pub enum BridgeMessageType {
    /// Single attestation result
    AttestationResult,
    /// Batch attestation submission
    BatchAttestation,
    /// State root update from Mina
    StateRootUpdate,
    /// Revocation of an attestation
    Revocation,
}

/// Public inputs for Mina attestation verification.
/// These are derived from the Mina recursive proof public inputs.
#[derive(Drop, Serde, Copy)]
pub struct MinaPublicInputs {
    /// Mina digest from the wrapper circuit
    pub mina_digest: felt252,
    /// Holder binding: H(holder_id || mina_digest || policy_id || scope)
    pub holder_binding: felt252,
    /// Policy ID
    pub policy_id: u64,
    /// Current epoch
    pub current_epoch: u64,
    /// Verifier scope ID
    pub verifier_scope_id: u64,
    /// Mina global slot
    pub mina_slot: u64,
    /// Nullifier for replay protection
    pub nullifier: felt252,
    /// Optional: threshold that was proven
    pub threshold: u64,
    /// Optional: currency code that was checked
    pub currency_code: u32,
}

/// Result of attestation submission.
#[derive(Drop, Serde)]
pub struct SubmitResult {
    pub success: bool,
    pub attestation_id: felt252,
    pub error_code: felt252,
}

/// Query result for attestation checks.
#[derive(Drop, Serde)]
pub struct AttestationQueryResult {
    pub has_valid_attestation: bool,
    pub attestation: MinaAttestation,
    pub starknet_block: u64,
}

#[starknet::interface]
pub trait IMinaStateVerifier<TContractState> {
    // === Attestation Submission ===
    
    /// Submit a Mina attestation from the bridge.
    /// Only authorized relayers can submit attestations.
    fn submit_attestation(
        ref self: TContractState,
        public_inputs: MinaPublicInputs,
        validity_window_slots: u64,
        source_rails_mask: u8,
    ) -> SubmitResult;

    /// Submit a batch of attestations.
    fn submit_attestation_batch(
        ref self: TContractState,
        attestations: Span<MinaPublicInputs>,
        validity_window_slots: u64,
        source_rails_mask: u8,
    ) -> Span<SubmitResult>;

    // === Attestation Queries ===
    
    /// Check if holder has valid PoF for policy.
    fn has_valid_pof(
        self: @TContractState,
        holder_binding: felt252,
        policy_id: u64,
    ) -> bool;

    /// Check if holder has valid PoF from a specific source rail.
    fn has_valid_pof_from_rail(
        self: @TContractState,
        holder_binding: felt252,
        policy_id: u64,
        source_rail: u8,
    ) -> bool;

    /// Get attestation details.
    fn get_attestation(
        self: @TContractState,
        attestation_id: felt252,
    ) -> MinaAttestation;

    /// Query attestation by holder binding and policy.
    fn query_attestation(
        self: @TContractState,
        holder_binding: felt252,
        policy_id: u64,
    ) -> AttestationQueryResult;

    /// Check if nullifier has been used.
    fn is_nullifier_used(self: @TContractState, nullifier: felt252) -> bool;

    // === State Management ===

    /// Revoke an attestation (admin or original relayer).
    fn revoke_attestation(ref self: TContractState, attestation_id: felt252);

    /// Update the Mina state root (for light client verification).
    fn update_mina_state_root(
        ref self: TContractState,
        new_state_root: felt252,
        mina_slot: u64,
    );

    /// Get current Mina state root.
    fn get_mina_state_root(self: @TContractState) -> (felt252, u64);

    // === Admin Functions ===

    /// Add an authorized relayer.
    fn add_relayer(ref self: TContractState, relayer: ContractAddress);

    /// Remove a relayer.
    fn remove_relayer(ref self: TContractState, relayer: ContractAddress);

    /// Check if address is an authorized relayer.
    fn is_relayer(self: @TContractState, address: ContractAddress) -> bool;

    /// Get admin address.
    fn get_admin(self: @TContractState) -> ContractAddress;

    /// Transfer admin.
    fn transfer_admin(ref self: TContractState, new_admin: ContractAddress);

    /// Get attestation validity window default (in Mina slots).
    fn get_default_validity_window(self: @TContractState) -> u64;

    /// Set default validity window.
    fn set_default_validity_window(ref self: TContractState, window: u64);
}

/// Events emitted by the contract.
#[derive(Drop, starknet::Event)]
pub struct MinaAttestationSubmitted {
    #[key]
    pub attestation_id: felt252,
    #[key]
    pub holder_binding: felt252,
    #[key]
    pub policy_id: u64,
    pub mina_digest: felt252,
    pub mina_slot: u64,
    pub expires_at_slot: u64,
    pub source_rails_mask: u8,
    pub relayer: ContractAddress,
}

#[derive(Drop, starknet::Event)]
pub struct MinaAttestationRevoked {
    #[key]
    pub attestation_id: felt252,
    pub revoker: ContractAddress,
}

#[derive(Drop, starknet::Event)]
pub struct MinaStateRootUpdated {
    pub old_root: felt252,
    pub new_root: felt252,
    pub mina_slot: u64,
}

#[derive(Drop, starknet::Event)]
pub struct RelayerAdded {
    #[key]
    pub relayer: ContractAddress,
}

#[derive(Drop, starknet::Event)]
pub struct RelayerRemoved {
    #[key]
    pub relayer: ContractAddress,
}

/// Error codes for the contract.
pub mod ErrorCodes {
    pub const NOT_RELAYER: felt252 = 'NOT_RELAYER';
    pub const NOT_ADMIN: felt252 = 'NOT_ADMIN';
    pub const NULLIFIER_USED: felt252 = 'NULLIFIER_USED';
    pub const ATTESTATION_EXISTS: felt252 = 'ATTESTATION_EXISTS';
    pub const ATTESTATION_NOT_FOUND: felt252 = 'ATTESTATION_NOT_FOUND';
    pub const ATTESTATION_EXPIRED: felt252 = 'ATTESTATION_EXPIRED';
    pub const INVALID_VALIDITY_WINDOW: felt252 = 'INVALID_VALIDITY_WINDOW';
    pub const NOT_AUTHORIZED_TO_REVOKE: felt252 = 'NOT_AUTHORIZED_TO_REVOKE';
    pub const INVALID_MINA_SLOT: felt252 = 'INVALID_MINA_SLOT';
}

#[starknet::contract]
pub mod MinaStateVerifierContract {
    use super::{
        IMinaStateVerifier, MinaAttestation, MinaPublicInputs, SubmitResult,
        AttestationQueryResult, ErrorCodes,
        MinaAttestationSubmitted, MinaAttestationRevoked, MinaStateRootUpdated,
        RelayerAdded, RelayerRemoved,
    };
    use starknet::{ContractAddress, get_caller_address, get_block_timestamp, get_block_number};
    use starknet::storage::{Map, StorageMapReadAccess, StorageMapWriteAccess, StoragePointerReadAccess, StoragePointerWriteAccess};
    use core::poseidon::PoseidonTrait;
    use core::hash::HashStateTrait;

    /// Default validity window: ~24 hours at 12s slots = 7200 slots
    const DEFAULT_VALIDITY_WINDOW: u64 = 7200;
    /// Maximum validity window: ~7 days
    const MAX_VALIDITY_WINDOW: u64 = 50400;

    #[storage]
    struct Storage {
        // Admin address
        admin: ContractAddress,
        // Authorized relayers
        relayers: Map<ContractAddress, bool>,
        // Attestations by ID
        attestations: Map<felt252, MinaAttestation>,
        // Attestation lookup by (holder_binding, policy_id) hash -> attestation_id
        attestation_lookup: Map<felt252, felt252>,
        // Used nullifiers
        nullifiers_used: Map<felt252, bool>,
        // Current Mina state root (for future light client verification)
        mina_state_root: felt252,
        // Mina slot of last state root update
        mina_state_root_slot: u64,
        // Default validity window in Mina slots
        default_validity_window: u64,
        // Total attestation count
        attestation_count: u64,
    }

    #[event]
    #[derive(Drop, starknet::Event)]
    enum Event {
        MinaAttestationSubmitted: MinaAttestationSubmitted,
        MinaAttestationRevoked: MinaAttestationRevoked,
        MinaStateRootUpdated: MinaStateRootUpdated,
        RelayerAdded: RelayerAdded,
        RelayerRemoved: RelayerRemoved,
    }

    #[constructor]
    fn constructor(ref self: ContractState, admin: ContractAddress) {
        self.admin.write(admin);
        // Admin is also a relayer by default
        self.relayers.write(admin, true);
        self.default_validity_window.write(DEFAULT_VALIDITY_WINDOW);
        self.mina_state_root.write(0);
        self.mina_state_root_slot.write(0);
        self.attestation_count.write(0);
    }

    #[abi(embed_v0)]
    impl MinaStateVerifierImpl of IMinaStateVerifier<ContractState> {
        fn submit_attestation(
            ref self: ContractState,
            public_inputs: MinaPublicInputs,
            validity_window_slots: u64,
            source_rails_mask: u8,
        ) -> SubmitResult {
            // Only authorized relayers can submit
            let caller = get_caller_address();
            if !self.relayers.read(caller) {
                return SubmitResult {
                    success: false,
                    attestation_id: 0,
                    error_code: ErrorCodes::NOT_RELAYER,
                };
            }

            // Check nullifier hasn't been used
            if self.nullifiers_used.read(public_inputs.nullifier) {
                return SubmitResult {
                    success: false,
                    attestation_id: 0,
                    error_code: ErrorCodes::NULLIFIER_USED,
                };
            }

            // Validate validity window
            let window = if validity_window_slots == 0 {
                self.default_validity_window.read()
            } else if validity_window_slots > MAX_VALIDITY_WINDOW {
                return SubmitResult {
                    success: false,
                    attestation_id: 0,
                    error_code: ErrorCodes::INVALID_VALIDITY_WINDOW,
                };
            } else {
                validity_window_slots
            };

            // Compute attestation ID
            let attestation_id = self._compute_attestation_id(
                public_inputs.holder_binding,
                public_inputs.policy_id,
                public_inputs.mina_digest,
                public_inputs.mina_slot,
            );

            // Check attestation doesn't already exist
            let lookup_key = self._compute_lookup_key(
                public_inputs.holder_binding,
                public_inputs.policy_id,
            );
            
            let existing_id = self.attestation_lookup.read(lookup_key);
            if existing_id != 0 {
                // Check if existing attestation is expired
                let existing = self.attestations.read(existing_id);
                if existing.is_valid && public_inputs.mina_slot < existing.expires_at_slot {
                    return SubmitResult {
                        success: false,
                        attestation_id: existing_id,
                        error_code: ErrorCodes::ATTESTATION_EXISTS,
                    };
                }
                // Expired attestation can be replaced
            }

            // Create attestation
            let attestation = MinaAttestation {
                mina_digest: public_inputs.mina_digest,
                holder_binding: public_inputs.holder_binding,
                policy_id: public_inputs.policy_id,
                epoch: public_inputs.current_epoch,
                mina_slot: public_inputs.mina_slot,
                expires_at_slot: public_inputs.mina_slot + window,
                source_rails_mask,
                bridged_at: get_block_timestamp(),
                relayer: caller,
                is_valid: true,
            };

            // Store attestation
            self.attestations.write(attestation_id, attestation);
            self.attestation_lookup.write(lookup_key, attestation_id);
            self.nullifiers_used.write(public_inputs.nullifier, true);
            
            // Increment counter
            let count = self.attestation_count.read();
            self.attestation_count.write(count + 1);

            // Emit event
            self.emit(MinaAttestationSubmitted {
                attestation_id,
                holder_binding: public_inputs.holder_binding,
                policy_id: public_inputs.policy_id,
                mina_digest: public_inputs.mina_digest,
                mina_slot: public_inputs.mina_slot,
                expires_at_slot: public_inputs.mina_slot + window,
                source_rails_mask,
                relayer: caller,
            });

            SubmitResult {
                success: true,
                attestation_id,
                error_code: 0,
            }
        }

        fn submit_attestation_batch(
            ref self: ContractState,
            attestations: Span<MinaPublicInputs>,
            validity_window_slots: u64,
            source_rails_mask: u8,
        ) -> Span<SubmitResult> {
            let mut results: Array<SubmitResult> = ArrayTrait::new();
            
            let len = attestations.len();
            let mut i: u32 = 0;
            loop {
                if i >= len {
                    break;
                }
                let result = self.submit_attestation(
                    *attestations.at(i),
                    validity_window_slots,
                    source_rails_mask,
                );
                results.append(result);
                i += 1;
            };
            
            results.span()
        }

        fn has_valid_pof(
            self: @ContractState,
            holder_binding: felt252,
            policy_id: u64,
        ) -> bool {
            let lookup_key = self._compute_lookup_key(holder_binding, policy_id);
            let attestation_id = self.attestation_lookup.read(lookup_key);
            
            if attestation_id == 0 {
                return false;
            }

            let attestation = self.attestations.read(attestation_id);
            attestation.is_valid
        }

        fn has_valid_pof_from_rail(
            self: @ContractState,
            holder_binding: felt252,
            policy_id: u64,
            source_rail: u8,
        ) -> bool {
            let lookup_key = self._compute_lookup_key(holder_binding, policy_id);
            let attestation_id = self.attestation_lookup.read(lookup_key);
            
            if attestation_id == 0 {
                return false;
            }

            let attestation = self.attestations.read(attestation_id);
            if !attestation.is_valid {
                return false;
            }

            // Check if the source rail is included
            let rail_bit: u8 = 1_u8 * self._pow2(source_rail);
            (attestation.source_rails_mask & rail_bit) != 0
        }

        fn get_attestation(
            self: @ContractState,
            attestation_id: felt252,
        ) -> MinaAttestation {
            self.attestations.read(attestation_id)
        }

        fn query_attestation(
            self: @ContractState,
            holder_binding: felt252,
            policy_id: u64,
        ) -> AttestationQueryResult {
            let lookup_key = self._compute_lookup_key(holder_binding, policy_id);
            let attestation_id = self.attestation_lookup.read(lookup_key);
            
            if attestation_id == 0 {
                return AttestationQueryResult {
                    has_valid_attestation: false,
                    attestation: MinaAttestation {
                        mina_digest: 0,
                        holder_binding: 0,
                        policy_id: 0,
                        epoch: 0,
                        mina_slot: 0,
                        expires_at_slot: 0,
                        source_rails_mask: 0,
                        bridged_at: 0,
                        relayer: 0.try_into().unwrap(),
                        is_valid: false,
                    },
                    starknet_block: get_block_number(),
                };
            }

            let attestation = self.attestations.read(attestation_id);
            AttestationQueryResult {
                has_valid_attestation: attestation.is_valid,
                attestation,
                starknet_block: get_block_number(),
            }
        }

        fn is_nullifier_used(self: @ContractState, nullifier: felt252) -> bool {
            self.nullifiers_used.read(nullifier)
        }

        fn revoke_attestation(ref self: ContractState, attestation_id: felt252) {
            let caller = get_caller_address();
            let attestation = self.attestations.read(attestation_id);
            
            // Only admin or original relayer can revoke
            let is_admin = caller == self.admin.read();
            let is_original_relayer = caller == attestation.relayer;
            
            assert(is_admin || is_original_relayer, ErrorCodes::NOT_AUTHORIZED_TO_REVOKE);

            // Mark as invalid
            let mut updated = attestation;
            updated.is_valid = false;
            self.attestations.write(attestation_id, updated);

            self.emit(MinaAttestationRevoked {
                attestation_id,
                revoker: caller,
            });
        }

        fn update_mina_state_root(
            ref self: ContractState,
            new_state_root: felt252,
            mina_slot: u64,
        ) {
            self._only_admin();
            
            // State root updates should be monotonic in slot number
            let current_slot = self.mina_state_root_slot.read();
            assert(mina_slot > current_slot, ErrorCodes::INVALID_MINA_SLOT);

            let old_root = self.mina_state_root.read();
            self.mina_state_root.write(new_state_root);
            self.mina_state_root_slot.write(mina_slot);

            self.emit(MinaStateRootUpdated {
                old_root,
                new_root: new_state_root,
                mina_slot,
            });
        }

        fn get_mina_state_root(self: @ContractState) -> (felt252, u64) {
            (self.mina_state_root.read(), self.mina_state_root_slot.read())
        }

        fn add_relayer(ref self: ContractState, relayer: ContractAddress) {
            self._only_admin();
            self.relayers.write(relayer, true);
            self.emit(RelayerAdded { relayer });
        }

        fn remove_relayer(ref self: ContractState, relayer: ContractAddress) {
            self._only_admin();
            // Cannot remove admin as relayer
            assert(relayer != self.admin.read(), 'Cannot remove admin relayer');
            self.relayers.write(relayer, false);
            self.emit(RelayerRemoved { relayer });
        }

        fn is_relayer(self: @ContractState, address: ContractAddress) -> bool {
            self.relayers.read(address)
        }

        fn get_admin(self: @ContractState) -> ContractAddress {
            self.admin.read()
        }

        fn transfer_admin(ref self: ContractState, new_admin: ContractAddress) {
            self._only_admin();
            let _old_admin = self.admin.read();
            self.admin.write(new_admin);
            // New admin is also a relayer
            self.relayers.write(new_admin, true);
        }

        fn get_default_validity_window(self: @ContractState) -> u64 {
            self.default_validity_window.read()
        }

        fn set_default_validity_window(ref self: ContractState, window: u64) {
            self._only_admin();
            assert(window <= MAX_VALIDITY_WINDOW, ErrorCodes::INVALID_VALIDITY_WINDOW);
            self.default_validity_window.write(window);
        }
    }

    #[generate_trait]
    impl InternalImpl of InternalTrait {
        fn _only_admin(self: @ContractState) {
            let caller = get_caller_address();
            assert(caller == self.admin.read(), ErrorCodes::NOT_ADMIN);
        }

        fn _compute_attestation_id(
            self: @ContractState,
            holder_binding: felt252,
            policy_id: u64,
            mina_digest: felt252,
            mina_slot: u64,
        ) -> felt252 {
            let mut state = PoseidonTrait::new();
            state = state.update('MINA_ATTESTATION_ID_V1');
            state = state.update(holder_binding);
            state = state.update(policy_id.into());
            state = state.update(mina_digest);
            state = state.update(mina_slot.into());
            state.finalize()
        }

        fn _compute_lookup_key(
            self: @ContractState,
            holder_binding: felt252,
            policy_id: u64,
        ) -> felt252 {
            let mut state = PoseidonTrait::new();
            state = state.update('MINA_LOOKUP_KEY_V1');
            state = state.update(holder_binding);
            state = state.update(policy_id.into());
            state.finalize()
        }

        fn _pow2(self: @ContractState, exp: u8) -> u8 {
            if exp == 0 {
                return 1;
            }
            if exp == 1 {
                return 2;
            }
            if exp == 2 {
                return 4;
            }
            if exp == 3 {
                return 8;
            }
            if exp == 4 {
                return 16;
            }
            if exp == 5 {
                return 32;
            }
            if exp == 6 {
                return 64;
            }
            if exp == 7 {
                return 128;
            }
            // exp >= 8 overflows u8
            0
        }
    }
}

/// Helper trait for DeFi integrations that want to require Mina-verified PoF.
#[starknet::interface]
pub trait IMinaGated<TContractState> {
    /// Check if holder has cross-chain PoF via Mina.
    fn check_mina_pof(
        self: @TContractState,
        holder_binding: felt252,
    ) -> bool;

    /// Get the Mina verifier address.
    fn get_mina_verifier(self: @TContractState) -> ContractAddress;

    /// Get required policy ID.
    fn get_required_policy_id(self: @TContractState) -> u64;
}

/// Example: Cross-chain gated lending using Mina attestations.
#[starknet::contract]
pub mod MinaGatedLending {
    use super::{IMinaGated, IMinaStateVerifierDispatcher, IMinaStateVerifierDispatcherTrait};
    use starknet::{ContractAddress, get_caller_address};
    use starknet::storage::{StoragePointerReadAccess, StoragePointerWriteAccess};

    #[storage]
    struct Storage {
        admin: ContractAddress,
        mina_verifier: ContractAddress,
        required_policy_id: u64,
    }

    #[constructor]
    fn constructor(
        ref self: ContractState,
        admin: ContractAddress,
        mina_verifier: ContractAddress,
        required_policy_id: u64,
    ) {
        self.admin.write(admin);
        self.mina_verifier.write(mina_verifier);
        self.required_policy_id.write(required_policy_id);
    }

    #[abi(embed_v0)]
    impl MinaGatedLendingImpl of IMinaGated<ContractState> {
        fn check_mina_pof(
            self: @ContractState,
            holder_binding: felt252,
        ) -> bool {
            let verifier = IMinaStateVerifierDispatcher {
                contract_address: self.mina_verifier.read()
            };
            verifier.has_valid_pof(holder_binding, self.required_policy_id.read())
        }

        fn get_mina_verifier(self: @ContractState) -> ContractAddress {
            self.mina_verifier.read()
        }

        fn get_required_policy_id(self: @ContractState) -> u64 {
            self.required_policy_id.read()
        }
    }

    /// Modifier-style function for gating access.
    #[generate_trait]
    impl RequiresMinaPofImpl of RequiresMinaPofTrait {
        fn require_mina_pof(self: @ContractState, holder_binding: felt252) {
            let has_pof = self.check_mina_pof(holder_binding);
            assert(has_pof, 'Cross-chain PoF required');
        }
    }

    /// Admin functions
    #[generate_trait]
    impl AdminImpl of AdminTrait {
        fn set_mina_verifier(ref self: ContractState, verifier: ContractAddress) {
            let caller = get_caller_address();
            assert(caller == self.admin.read(), 'Not admin');
            self.mina_verifier.write(verifier);
        }

        fn set_required_policy_id(ref self: ContractState, policy_id: u64) {
            let caller = get_caller_address();
            assert(caller == self.admin.read(), 'Not admin');
            self.required_policy_id.write(policy_id);
        }
    }
}

