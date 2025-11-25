// zkUSD Stablecoin for Starknet
// SPDX-License-Identifier: MIT

use starknet::ContractAddress;

#[starknet::interface]
trait IzkUSD<TContractState> {
    // ERC20 standard
    fn name(self: @TContractState) -> ByteArray;
    fn symbol(self: @TContractState) -> ByteArray;
    fn decimals(self: @TContractState) -> u8;
    fn total_supply(self: @TContractState) -> u256;
    fn balance_of(self: @TContractState, account: ContractAddress) -> u256;
    fn allowance(self: @TContractState, owner: ContractAddress, spender: ContractAddress) -> u256;
    fn transfer(ref self: TContractState, recipient: ContractAddress, amount: u256) -> bool;
    fn transfer_from(ref self: TContractState, sender: ContractAddress, recipient: ContractAddress, amount: u256) -> bool;
    fn approve(ref self: TContractState, spender: ContractAddress, amount: u256) -> bool;
    
    // zkUSD specific
    fn mint(ref self: TContractState, usdc_amount: u256) -> u256;
    fn redeem(ref self: TContractState, zkusd_amount: u256) -> u256;
    fn reserve_asset(self: @TContractState) -> ContractAddress;
    fn reserve_ratio(self: @TContractState) -> u256;
    fn get_reserve_proof(self: @TContractState) -> (u256, u256, u256);
    fn fee_bps(self: @TContractState) -> u256;
    fn min_amount(self: @TContractState) -> u256;
}

#[starknet::contract]
mod zkUSD {
    use starknet::{ContractAddress, get_caller_address, get_contract_address};
    use starknet::storage::{StoragePointerReadAccess, StoragePointerWriteAccess, Map};
    use openzeppelin::token::erc20::interface::{IERC20Dispatcher, IERC20DispatcherTrait};
    use core::num::traits::Zero;

    #[storage]
    struct Storage {
        // ERC20 storage
        name: ByteArray,
        symbol: ByteArray,
        total_supply: u256,
        balances: Map<ContractAddress, u256>,
        allowances: Map<(ContractAddress, ContractAddress), u256>,
        
        // zkUSD specific
        reserve_asset: ContractAddress,  // USDC address
        fee_bps: u256,                   // Protocol fee in basis points
        fee_recipient: ContractAddress,
        min_amount: u256,                // Minimum mint/redeem amount
        total_fees_collected: u256,
        owner: ContractAddress,
        paused: bool,
    }

    #[event]
    #[derive(Drop, starknet::Event)]
    enum Event {
        Transfer: Transfer,
        Approval: Approval,
        Mint: Mint,
        Redeem: Redeem,
    }

    #[derive(Drop, starknet::Event)]
    struct Transfer {
        #[key]
        from: ContractAddress,
        #[key]
        to: ContractAddress,
        value: u256,
    }

    #[derive(Drop, starknet::Event)]
    struct Approval {
        #[key]
        owner: ContractAddress,
        #[key]
        spender: ContractAddress,
        value: u256,
    }

    #[derive(Drop, starknet::Event)]
    struct Mint {
        #[key]
        user: ContractAddress,
        usdc_amount: u256,
        zkusd_minted: u256,
        fee: u256,
    }

    #[derive(Drop, starknet::Event)]
    struct Redeem {
        #[key]
        user: ContractAddress,
        zkusd_burned: u256,
        usdc_returned: u256,
        fee: u256,
    }

    #[constructor]
    fn constructor(
        ref self: ContractState,
        reserve_asset: ContractAddress,
        fee_recipient: ContractAddress,
        owner: ContractAddress,
    ) {
        self.name.write("zkpf USD");
        self.symbol.write("zkUSD");
        self.reserve_asset.write(reserve_asset);
        self.fee_recipient.write(fee_recipient);
        self.owner.write(owner);
        self.fee_bps.write(0);  // Start with no fee
        self.min_amount.write(1000000);  // $1 minimum (6 decimals)
        self.paused.write(false);
    }

    #[abi(embed_v0)]
    impl zkUSDImpl of super::IzkUSD<ContractState> {
        fn name(self: @ContractState) -> ByteArray {
            self.name.read()
        }

        fn symbol(self: @ContractState) -> ByteArray {
            self.symbol.read()
        }

        fn decimals(self: @ContractState) -> u8 {
            6  // Match USDC decimals
        }

        fn total_supply(self: @ContractState) -> u256 {
            self.total_supply.read()
        }

        fn balance_of(self: @ContractState, account: ContractAddress) -> u256 {
            self.balances.read(account)
        }

        fn allowance(self: @ContractState, owner: ContractAddress, spender: ContractAddress) -> u256 {
            self.allowances.read((owner, spender))
        }

        fn transfer(ref self: ContractState, recipient: ContractAddress, amount: u256) -> bool {
            let sender = get_caller_address();
            self._transfer(sender, recipient, amount);
            true
        }

        fn transfer_from(
            ref self: ContractState,
            sender: ContractAddress,
            recipient: ContractAddress,
            amount: u256
        ) -> bool {
            let caller = get_caller_address();
            let current_allowance = self.allowances.read((sender, caller));
            assert(current_allowance >= amount, 'Insufficient allowance');
            
            self.allowances.write((sender, caller), current_allowance - amount);
            self._transfer(sender, recipient, amount);
            true
        }

        fn approve(ref self: ContractState, spender: ContractAddress, amount: u256) -> bool {
            let owner = get_caller_address();
            self.allowances.write((owner, spender), amount);
            self.emit(Approval { owner, spender, value: amount });
            true
        }

        /// Mint zkUSD by depositing USDC
        fn mint(ref self: ContractState, usdc_amount: u256) -> u256 {
            assert(!self.paused.read(), 'Contract paused');
            assert(usdc_amount >= self.min_amount.read(), 'Below minimum');
            
            let caller = get_caller_address();
            let this = get_contract_address();
            let reserve = IERC20Dispatcher { contract_address: self.reserve_asset.read() };
            
            // Calculate fee
            let fee_bps = self.fee_bps.read();
            let fee = (usdc_amount * fee_bps) / 10000;
            let net_amount = usdc_amount - fee;
            
            // Transfer USDC from user
            reserve.transfer_from(caller, this, usdc_amount);
            
            // Transfer fee to recipient
            if fee > 0 {
                let fee_recipient = self.fee_recipient.read();
                if !fee_recipient.is_zero() {
                    reserve.transfer(fee_recipient, fee);
                    let total_fees = self.total_fees_collected.read();
                    self.total_fees_collected.write(total_fees + fee);
                }
            }
            
            // Mint zkUSD 1:1 with net USDC
            self._mint(caller, net_amount);
            
            self.emit(Mint { user: caller, usdc_amount, zkusd_minted: net_amount, fee });
            
            net_amount
        }

        /// Redeem USDC by burning zkUSD
        fn redeem(ref self: ContractState, zkusd_amount: u256) -> u256 {
            assert(!self.paused.read(), 'Contract paused');
            assert(zkusd_amount >= self.min_amount.read(), 'Below minimum');
            
            let caller = get_caller_address();
            let balance = self.balances.read(caller);
            assert(balance >= zkusd_amount, 'Insufficient balance');
            
            // Calculate fee
            let fee_bps = self.fee_bps.read();
            let fee = (zkusd_amount * fee_bps) / 10000;
            let net_amount = zkusd_amount - fee;
            
            // Burn zkUSD
            self._burn(caller, zkusd_amount);
            
            // Transfer USDC to user
            let reserve = IERC20Dispatcher { contract_address: self.reserve_asset.read() };
            reserve.transfer(caller, net_amount);
            
            // Transfer fee
            if fee > 0 {
                let fee_recipient = self.fee_recipient.read();
                if !fee_recipient.is_zero() {
                    reserve.transfer(fee_recipient, fee);
                    let total_fees = self.total_fees_collected.read();
                    self.total_fees_collected.write(total_fees + fee);
                }
            }
            
            self.emit(Redeem { user: caller, zkusd_burned: zkusd_amount, usdc_returned: net_amount, fee });
            
            net_amount
        }

        fn reserve_asset(self: @ContractState) -> ContractAddress {
            self.reserve_asset.read()
        }

        fn reserve_ratio(self: @ContractState) -> u256 {
            let supply = self.total_supply.read();
            if supply == 0 {
                return 10000;  // 100%
            }
            
            let reserve = IERC20Dispatcher { contract_address: self.reserve_asset.read() };
            let reserves = reserve.balance_of(get_contract_address());
            
            (reserves * 10000) / supply
        }

        /// Get proof-of-reserves data for zkpf circuit
        fn get_reserve_proof(self: @ContractState) -> (u256, u256, u256) {
            let reserve = IERC20Dispatcher { contract_address: self.reserve_asset.read() };
            let reserves = reserve.balance_of(get_contract_address());
            let supply = self.total_supply.read();
            let ratio = if supply == 0 { 10000 } else { (reserves * 10000) / supply };
            
            (reserves, supply, ratio)
        }

        fn fee_bps(self: @ContractState) -> u256 {
            self.fee_bps.read()
        }

        fn min_amount(self: @ContractState) -> u256 {
            self.min_amount.read()
        }
    }

    #[generate_trait]
    impl InternalImpl of InternalTrait {
        fn _transfer(
            ref self: ContractState,
            sender: ContractAddress,
            recipient: ContractAddress,
            amount: u256
        ) {
            assert(!sender.is_zero(), 'Transfer from zero');
            assert(!recipient.is_zero(), 'Transfer to zero');
            
            let sender_balance = self.balances.read(sender);
            assert(sender_balance >= amount, 'Insufficient balance');
            
            self.balances.write(sender, sender_balance - amount);
            let recipient_balance = self.balances.read(recipient);
            self.balances.write(recipient, recipient_balance + amount);
            
            self.emit(Transfer { from: sender, to: recipient, value: amount });
        }

        fn _mint(ref self: ContractState, account: ContractAddress, amount: u256) {
            assert(!account.is_zero(), 'Mint to zero');
            
            let supply = self.total_supply.read();
            self.total_supply.write(supply + amount);
            
            let balance = self.balances.read(account);
            self.balances.write(account, balance + amount);
            
            self.emit(Transfer { from: Zero::zero(), to: account, value: amount });
        }

        fn _burn(ref self: ContractState, account: ContractAddress, amount: u256) {
            assert(!account.is_zero(), 'Burn from zero');
            
            let balance = self.balances.read(account);
            assert(balance >= amount, 'Burn exceeds balance');
            
            self.balances.write(account, balance - amount);
            
            let supply = self.total_supply.read();
            self.total_supply.write(supply - amount);
            
            self.emit(Transfer { from: account, to: Zero::zero(), value: amount });
        }
    }
}

