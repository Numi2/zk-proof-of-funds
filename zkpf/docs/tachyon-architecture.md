# Tachyon Architecture

A unified, multi-chain, privacy-preserving wallet that orchestrates zero-knowledge proofs across five chains, using each only for its comparative advantage.

## Design Philosophy

**Never bridge assets, only proofs and attestations.** Zcash's privacy and ledger indistinguishability are hard constraints.

## Chain Responsibilities

| Chain | Role | Why This Chain |
|-------|------|----------------|
| **Zcash (Orchard)** | Privacy-preserving balance proofs | Gold-standard shielded UTXOs, strongest privacy guarantees |
| **Mina** | PCD/recursive SNARK aggregation | Constant-size proofs, infinite recursion depth |
| **Starknet** | Heavy proving, DeFi positions | Cheap STARK proving, native AA, rich DeFi ecosystem |
| **Axelar** | Cross-chain proof transport | Battle-tested GMP infrastructure |
| **NEAR** | TEE-backed private AI agent | Confidential compute enclaves for wallet intelligence |

## Architecture Overview

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                        TachyonWallet Coordinator                             │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                              │
│  ┌──────────────────┐  ┌──────────────────┐  ┌──────────────────┐          │
│  │   ZcashRail      │  │   MinaRail       │  │  StarknetRail    │          │
│  │                  │  │                  │  │                  │          │
│  │ • Shielded PoF   │  │ • Recursive agg  │  │ • DeFi positions │          │
│  │ • Note tree      │  │ • PCD state      │  │ • Session keys   │          │
│  │ • PCZT flow      │  │ • zkBridge ready │  │ • Account AA     │          │
│  └────────┬─────────┘  └────────┬─────────┘  └────────┬─────────┘          │
│           │                     │                     │                     │
│           └─────────────────────┼─────────────────────┘                     │
│                                 │                                           │
│                                 ▼                                           │
│                    ┌────────────────────────┐                               │
│                    │    ProofAggregator     │                               │
│                    │                        │                               │
│                    │ • Single-rail proofs   │                               │
│                    │ • Multi-rail sum       │                               │
│                    │ • Mina recursion       │                               │
│                    └────────────┬───────────┘                               │
│                                 │                                           │
│           ┌─────────────────────┼─────────────────────┐                     │
│           ▼                     ▼                     ▼                     │
│  ┌──────────────────┐  ┌──────────────────┐  ┌──────────────────┐          │
│  │ AxelarTransport  │  │ AttestationMgr   │  │   NEARAgent      │          │
│  │                  │  │                  │  │                  │          │
│  │ • GMP messages   │  │ • Cross-chain    │  │ • TEE inference  │          │
│  │ • Receipt relay  │  │   attestations   │  │ • Key derivation │          │
│  │ • Revocations    │  │ • Validity track │  │ • Privacy filter │          │
│  └──────────────────┘  └──────────────────┘  └──────────────────┘          │
│                                                                              │
└─────────────────────────────────────────────────────────────────────────────┘
```

## Proof Flow

### 1. Single-Rail Proof (Privacy-Optimized)

```
User Request → Zcash Rail → Orchard PoF Circuit → ProofBundle
```

Use when privacy is paramount. Zcash provides the strongest guarantees.

### 2. Multi-Rail Aggregation (Balance Aggregation)

```
User Request → [Zcash Rail, Starknet Rail] → Mina Recursive Aggregator → ProofBundle
```

When proving combined balance across chains without revealing individual amounts:

1. Each rail generates its own PoF proof
2. Mina wraps all proofs recursively
3. Single proof attests to aggregate balance

### 3. Cross-Chain Attestation

```
ProofBundle → Attestation → Axelar GMP → Target Chains
```

After proof generation, broadcast attestation via Axelar:

1. Create `UnifiedAttestation` from proof
2. Encode as GMP message
3. Relay to target chains (Starknet, NEAR, etc.)
4. Receiver contracts store attestation

## Crate Structure

```
zkpf/
├── zkpf-tachyon-wallet/     # Unified coordinator
│   ├── src/
│   │   ├── coordinator.rs   # Main TachyonWallet type
│   │   ├── rails.rs         # Rail abstraction trait
│   │   ├── aggregator.rs    # Proof aggregation strategies
│   │   ├── attestation.rs   # Cross-chain attestation types
│   │   ├── transport.rs     # Axelar GMP integration
│   │   ├── state.rs         # Wallet state management
│   │   └── config.rs        # Configuration types
│   └── Cargo.toml
│
├── zkpf-near-tee/           # NEAR TEE agent
│   ├── src/
│   │   ├── agent.rs         # NearAgent implementation
│   │   ├── attestation.rs   # TEE attestation
│   │   ├── crypto.rs        # TEE key management
│   │   ├── inference.rs     # Privacy-filtered AI
│   │   └── rpc.rs           # NEAR RPC client
│   └── Cargo.toml
│
├── zkpf-zcash-orchard-wallet/  # Zcash Orchard backend
├── zkpf-mina/                   # Mina recursive proofs
├── zkpf-starknet-l2/            # Starknet DeFi proofs
└── zkpf-axelar-gmp/             # Axelar GMP types
```

## Configuration

```rust
let config = TachyonConfig {
    network: NetworkEnvironment::Mainnet,
    rails: hashmap! {
        "ZCASH_ORCHARD" => RailConfig {
            enabled: true,
            endpoint: ChainEndpoint::Lightwalletd { 
                url: "https://mainnet.lightwalletd.com:9067".into() 
            },
            ..
        },
        "MINA_RECURSIVE" => RailConfig { .. },
        "STARKNET_L2" => RailConfig { .. },
    },
    axelar: AxelarConfig {
        enabled: true,
        gateway_address: Some("0x...".into()),
        destination_chains: vec![
            DestinationChain { chain_name: "starknet", .. },
            DestinationChain { chain_name: "near", .. },
        ],
        ..
    },
    near_agent: Some(NearAgentConfig {
        network: NearNetwork::Mainnet,
        agent_account_id: "zkpf-agent.near".into(),
        tee: TeeConfig { provider: TeeProvider::IntelSgx, .. },
        ..
    }),
    privacy: PrivacyConfig {
        min_proof_interval_secs: 60,
        randomize_timing: true,
        min_anonymity_set: 1000,
        ..
    },
    ..
};
```

## Aggregation Strategies

### `SingleRail`
Use one rail (typically Zcash for privacy).

```rust
AggregationStrategy::SingleRail { rail_id: "ZCASH_ORCHARD" }
```

### `SumAcrossRails`
Aggregate balances across multiple rails via Mina recursion.

```rust
AggregationStrategy::SumAcrossRails { 
    rails: vec!["ZCASH_ORCHARD", "STARKNET_L2"],
    fail_fast: false 
}
```

### `HighestBalance`
Select rail with highest balance for the required currency.

```rust
AggregationStrategy::HighestBalance {
    rails: vec!["ZCASH_ORCHARD", "STARKNET_L2"]
}
```

## NEAR TEE Agent Capabilities

The TEE agent runs in a Trusted Execution Environment for:

1. **Wallet Analysis** - Privacy-preserving portfolio insights
2. **Proof Strategy** - Recommend optimal rail selection
3. **Intent Parsing** - Natural language to structured actions
4. **Key Derivation** - Secure key management within TEE
5. **Privacy Filtering** - Ensure AI outputs don't leak sensitive data

```rust
let action = AgentAction::SuggestProofStrategy {
    policy_id: 100001,
    available_rails: vec!["ZCASH_ORCHARD", "STARKNET_L2"],
    balance_commitment: [0u8; 32],
};

let response = agent.execute(action).await?;
// AgentResponse::ProofStrategy { recommended_rail: "ZCASH_ORCHARD", .. }
```

## Security Invariants

1. **No asset bridging** - Only proofs cross chains
2. **Nullifier binding** - Prevent proof replay
3. **TEE attestation** - Verify agent runs in genuine enclave
4. **Privacy filter** - AI outputs cannot leak wallet data
5. **Trusted sources** - Axelar receivers validate message origins
6. **Timing randomization** - Prevent timing analysis attacks

## Frontend Integration

The React frontend provides:

- **Unified balance view** across all chains
- **Rail status dashboard** with sync progress
- **Proof generation** with rail selection
- **Attestation tracking** with cross-chain status
- **Agent chat** (when TEE connected)

```tsx
import { TachyonWallet } from './components/tachyon';

function App() {
  return <TachyonWallet />;
}
```

## Future Work

- [ ] Cairo-native Starknet circuit (STARK verification, no curve overhead)
- [ ] Cross-L2 proofs (Starknet + zkSync + Scroll)
- [ ] STARK recursion for bulk account aggregation
- [ ] Real-time DeFi position streaming
- [ ] Hardware wallet integration for TEE key backup

