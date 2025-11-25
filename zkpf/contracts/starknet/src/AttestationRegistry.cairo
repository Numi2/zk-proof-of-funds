// SPDX-License-Identifier: MIT
// AttestationRegistry for Starknet
// 
// This contract mirrors the Solidity AttestationRegistry but is designed for
// Starknet's Cairo environment. It allows zkpf proofs verified off-chain to
// be recorded on Starknet, enabling local dApps to trust zkpf PoF without
// going back to L1.

use starknet::ContractAddress;

#[starknet::interface]
pub trait IAttestationRegistry<TContractState> {
    /// Record a new attestation.
    fn attest(
        ref self: TContractState,
        holder_id: felt252,
        policy_id: u64,
        snapshot_id: felt252,
        nullifier: felt252,
    ) -> felt252;

    /// Get an attestation by ID.
    fn get_attestation(self: @TContractState, attestation_id: felt252) -> Attestation;

    /// Check if an attestation exists for holder/policy/snapshot.
    fn has_attestation(
        self: @TContractState,
        holder_id: felt252,
        policy_id: u64,
        snapshot_id: felt252,
    ) -> bool;

    /// Check if a nullifier has been used.
    fn is_nullifier_used(self: @TContractState, nullifier: felt252) -> bool;

    /// Get the attestor role admin.
    fn get_attestor_admin(self: @TContractState) -> ContractAddress;

    /// Check if an address is an authorized attestor.
    fn is_attestor(self: @TContractState, address: ContractAddress) -> bool;

    /// Add an attestor (admin only).
    fn add_attestor(ref self: TContractState, address: ContractAddress);

    /// Remove an attestor (admin only).
    fn remove_attestor(ref self: TContractState, address: ContractAddress);

    /// Transfer admin role.
    fn transfer_admin(ref self: TContractState, new_admin: ContractAddress);
}

/// Attestation record struct.
#[derive(Drop, Serde, starknet::Store, Copy)]
pub struct Attestation {
    pub holder_id: felt252,
    pub policy_id: u64,
    pub snapshot_id: felt252,
    pub nullifier: felt252,
    pub issued_at: u64,
    pub attestor: ContractAddress,
}

/// Events emitted by the registry.
#[derive(Drop, starknet::Event)]
pub struct Attested {
    #[key]
    pub attestation_id: felt252,
    #[key]
    pub holder_id: felt252,
    #[key]
    pub policy_id: u64,
    pub snapshot_id: felt252,
    pub nullifier: felt252,
    pub attestor: ContractAddress,
}

#[derive(Drop, starknet::Event)]
pub struct AttestorAdded {
    #[key]
    pub attestor: ContractAddress,
}

#[derive(Drop, starknet::Event)]
pub struct AttestorRemoved {
    #[key]
    pub attestor: ContractAddress,
}

#[derive(Drop, starknet::Event)]
pub struct AdminTransferred {
    pub old_admin: ContractAddress,
    pub new_admin: ContractAddress,
}

#[starknet::contract]
pub mod AttestationRegistryContract {
    use super::{IAttestationRegistry, Attestation, Attested, AttestorAdded, AttestorRemoved, AdminTransferred};
    use starknet::{ContractAddress, get_caller_address, get_block_timestamp};
    use starknet::storage::{Map, StorageMapReadAccess, StorageMapWriteAccess, StoragePointerReadAccess, StoragePointerWriteAccess};
    use core::poseidon::PoseidonTrait;
    use core::hash::HashStateTrait;

    #[storage]
    struct Storage {
        // Admin who can manage attestors
        admin: ContractAddress,
        // Mapping from address to attestor status
        attestors: Map<ContractAddress, bool>,
        // Mapping from attestation_id to Attestation
        attestations: Map<felt252, Attestation>,
        // Mapping from (holder_id, policy_id, snapshot_id) hash to exists
        attestation_exists: Map<felt252, bool>,
        // Mapping from nullifier to used status
        nullifiers_used: Map<felt252, bool>,
    }

    #[event]
    #[derive(Drop, starknet::Event)]
    enum Event {
        Attested: Attested,
        AttestorAdded: AttestorAdded,
        AttestorRemoved: AttestorRemoved,
        AdminTransferred: AdminTransferred,
    }

    #[constructor]
    fn constructor(ref self: ContractState, admin: ContractAddress) {
        self.admin.write(admin);
        // Admin is also an attestor by default
        self.attestors.write(admin, true);
    }

    #[abi(embed_v0)]
    impl AttestationRegistryImpl of IAttestationRegistry<ContractState> {
        fn attest(
            ref self: ContractState,
            holder_id: felt252,
            policy_id: u64,
            snapshot_id: felt252,
            nullifier: felt252,
        ) -> felt252 {
            // Only authorized attestors can record attestations
            let caller = get_caller_address();
            assert(self.attestors.read(caller), 'Caller is not an attestor');

            // Check nullifier hasn't been used
            assert(!self.nullifiers_used.read(nullifier), 'Nullifier already used');

            // Compute attestation ID using Poseidon hash
            let attestation_id = self._compute_attestation_id(
                holder_id, policy_id, snapshot_id, nullifier, caller
            );

            // Check attestation doesn't already exist
            let exists_key = self._compute_exists_key(holder_id, policy_id, snapshot_id);
            assert(!self.attestation_exists.read(exists_key), 'Attestation already exists');

            // Record the attestation
            let attestation = Attestation {
                holder_id,
                policy_id,
                snapshot_id,
                nullifier,
                issued_at: get_block_timestamp(),
                attestor: caller,
            };

            self.attestations.write(attestation_id, attestation);
            self.attestation_exists.write(exists_key, true);
            self.nullifiers_used.write(nullifier, true);

            // Emit event
            self.emit(Attested {
                attestation_id,
                holder_id,
                policy_id,
                snapshot_id,
                nullifier,
                attestor: caller,
            });

            attestation_id
        }

        fn get_attestation(self: @ContractState, attestation_id: felt252) -> Attestation {
            self.attestations.read(attestation_id)
        }

        fn has_attestation(
            self: @ContractState,
            holder_id: felt252,
            policy_id: u64,
            snapshot_id: felt252,
        ) -> bool {
            let exists_key = self._compute_exists_key(holder_id, policy_id, snapshot_id);
            self.attestation_exists.read(exists_key)
        }

        fn is_nullifier_used(self: @ContractState, nullifier: felt252) -> bool {
            self.nullifiers_used.read(nullifier)
        }

        fn get_attestor_admin(self: @ContractState) -> ContractAddress {
            self.admin.read()
        }

        fn is_attestor(self: @ContractState, address: ContractAddress) -> bool {
            self.attestors.read(address)
        }

        fn add_attestor(ref self: ContractState, address: ContractAddress) {
            self._only_admin();
            self.attestors.write(address, true);
            self.emit(AttestorAdded { attestor: address });
        }

        fn remove_attestor(ref self: ContractState, address: ContractAddress) {
            self._only_admin();
            // Cannot remove the admin as attestor
            assert(address != self.admin.read(), 'Cannot remove admin attestor');
            self.attestors.write(address, false);
            self.emit(AttestorRemoved { attestor: address });
        }

        fn transfer_admin(ref self: ContractState, new_admin: ContractAddress) {
            self._only_admin();
            let old_admin = self.admin.read();
            self.admin.write(new_admin);
            // New admin is also an attestor
            self.attestors.write(new_admin, true);
            self.emit(AdminTransferred { old_admin, new_admin });
        }
    }

    #[generate_trait]
    impl InternalImpl of InternalTrait {
        fn _only_admin(self: @ContractState) {
            let caller = get_caller_address();
            assert(caller == self.admin.read(), 'Caller is not admin');
        }

        fn _compute_attestation_id(
            self: @ContractState,
            holder_id: felt252,
            policy_id: u64,
            snapshot_id: felt252,
            nullifier: felt252,
            attestor: ContractAddress,
        ) -> felt252 {
            // Use Poseidon hash for attestation ID
            let mut state = PoseidonTrait::new();
            state = state.update(holder_id);
            state = state.update(policy_id.into());
            state = state.update(snapshot_id);
            state = state.update(nullifier);
            state = state.update(attestor.into());
            state = state.update(get_block_timestamp().into());
            state.finalize()
        }

        fn _compute_exists_key(
            self: @ContractState,
            holder_id: felt252,
            policy_id: u64,
            snapshot_id: felt252,
        ) -> felt252 {
            // Use Poseidon hash for exists key
            let mut state = PoseidonTrait::new();
            state = state.update(holder_id);
            state = state.update(policy_id.into());
            state = state.update(snapshot_id);
            state.finalize()
        }
    }
}
