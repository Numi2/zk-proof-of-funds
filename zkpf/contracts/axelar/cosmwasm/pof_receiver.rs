//! PoF Receiver CosmWasm Contract
//!
//! This contract receives zkpf Proof-of-Funds receipts via Axelar GMP
//! and allows dApps on Cosmos chains (Osmosis, Neutron, etc.) to check
//! PoF status without custom bridges.

use cosmwasm_schema::{cw_serde, QueryResponses};
use cosmwasm_std::{
    entry_point, to_json_binary, Addr, Binary, Deps, DepsMut, Env, MessageInfo, Response,
    StdError, StdResult, Uint128, Uint64,
};
use cw_storage_plus::{Item, Map};

// ═══════════════════════════════════════════════════════════════════════════════
// TYPES
// ═══════════════════════════════════════════════════════════════════════════════

/// Stored PoF receipt
#[cw_serde]
pub struct StoredReceipt {
    pub holder_id: String,
    pub policy_id: Uint64,
    pub snapshot_id: String,
    pub chain_id_origin: Uint64,
    pub attestation_hash: String,
    pub issued_at: Uint64,
    pub expires_at: Uint64,
    pub valid: bool,
}

/// Trusted source configuration
#[cw_serde]
pub struct TrustedSource {
    pub chain_name: String,
    pub bridge_contract: String,
    pub active: bool,
}

/// Contract configuration
#[cw_serde]
pub struct Config {
    pub admin: Addr,
    pub gateway: Addr,
    pub keep_expired_receipts: bool,
}

/// Message types for GMP payloads
#[cw_serde]
pub enum MessageType {
    PoFReceipt,
    PoFRevocation,
    PoFQuery,
}

// ═══════════════════════════════════════════════════════════════════════════════
// STATE
// ═══════════════════════════════════════════════════════════════════════════════

/// Contract configuration
pub const CONFIG: Item<Config> = Item::new("config");

/// Trusted sources by chain name
pub const TRUSTED_SOURCES: Map<&str, TrustedSource> = Map::new("trusted_sources");

/// List of trusted chain names
pub const TRUSTED_CHAINS: Item<Vec<String>> = Item::new("trusted_chains");

/// Stored receipts by (holder_id, policy_id, snapshot_id) key
pub const RECEIPTS: Map<&str, StoredReceipt> = Map::new("receipts");

/// Latest snapshot per (holder_id, policy_id)
pub const LATEST_SNAPSHOT: Map<&str, String> = Map::new("latest_snapshot");

/// Policy IDs per holder
pub const HOLDER_POLICIES: Map<&str, Vec<u64>> = Map::new("holder_policies");

// ═══════════════════════════════════════════════════════════════════════════════
// MESSAGES
// ═══════════════════════════════════════════════════════════════════════════════

#[cw_serde]
pub struct InstantiateMsg {
    pub gateway: String,
}

#[cw_serde]
pub enum ExecuteMsg {
    /// Add a trusted source bridge
    AddTrustedSource {
        chain_name: String,
        bridge_contract: String,
    },
    /// Remove a trusted source
    RemoveTrustedSource { chain_name: String },
    /// Transfer admin role
    TransferAdmin { new_admin: String },
    /// Execute Axelar GMP message (called by gateway)
    Execute {
        source_chain: String,
        source_address: String,
        payload: Binary,
    },
    /// Set whether to keep expired receipts
    SetKeepExpiredReceipts { keep: bool },
}

#[cw_serde]
#[derive(QueryResponses)]
pub enum QueryMsg {
    /// Check if holder has valid PoF for policy
    #[returns(CheckPoFResponse)]
    CheckPoF { holder_id: String, policy_id: Uint64 },

    /// Check if holder has PoF for specific snapshot
    #[returns(bool)]
    HasPoFForSnapshot {
        holder_id: String,
        policy_id: Uint64,
        snapshot_id: String,
    },

    /// Get all policy IDs for a holder
    #[returns(Vec<Uint64>)]
    GetHolderPolicies { holder_id: String },

    /// Get a specific receipt
    #[returns(StoredReceipt)]
    GetReceipt {
        holder_id: String,
        policy_id: Uint64,
        snapshot_id: String,
    },

    /// Get latest receipt for holder/policy
    #[returns(StoredReceipt)]
    GetLatestReceipt { holder_id: String, policy_id: Uint64 },

    /// Get contract config
    #[returns(Config)]
    Config {},

    /// Get all trusted sources
    #[returns(Vec<TrustedSource>)]
    TrustedSources {},
}

#[cw_serde]
pub struct CheckPoFResponse {
    pub has_pof: bool,
    pub receipt: Option<StoredReceipt>,
}

// ═══════════════════════════════════════════════════════════════════════════════
// INSTANTIATE
// ═══════════════════════════════════════════════════════════════════════════════

#[cfg_attr(not(feature = "library"), entry_point)]
pub fn instantiate(
    deps: DepsMut,
    _env: Env,
    info: MessageInfo,
    msg: InstantiateMsg,
) -> StdResult<Response> {
    let config = Config {
        admin: info.sender,
        gateway: deps.api.addr_validate(&msg.gateway)?,
        keep_expired_receipts: true,
    };
    CONFIG.save(deps.storage, &config)?;
    TRUSTED_CHAINS.save(deps.storage, &vec![])?;

    Ok(Response::new().add_attribute("action", "instantiate"))
}

// ═══════════════════════════════════════════════════════════════════════════════
// EXECUTE
// ═══════════════════════════════════════════════════════════════════════════════

#[cfg_attr(not(feature = "library"), entry_point)]
pub fn execute(deps: DepsMut, env: Env, info: MessageInfo, msg: ExecuteMsg) -> StdResult<Response> {
    match msg {
        ExecuteMsg::AddTrustedSource {
            chain_name,
            bridge_contract,
        } => execute_add_trusted_source(deps, info, chain_name, bridge_contract),
        ExecuteMsg::RemoveTrustedSource { chain_name } => {
            execute_remove_trusted_source(deps, info, chain_name)
        }
        ExecuteMsg::TransferAdmin { new_admin } => execute_transfer_admin(deps, info, new_admin),
        ExecuteMsg::Execute {
            source_chain,
            source_address,
            payload,
        } => execute_gmp(deps, env, info, source_chain, source_address, payload),
        ExecuteMsg::SetKeepExpiredReceipts { keep } => {
            execute_set_keep_expired_receipts(deps, info, keep)
        }
    }
}

fn execute_add_trusted_source(
    deps: DepsMut,
    info: MessageInfo,
    chain_name: String,
    bridge_contract: String,
) -> StdResult<Response> {
    let config = CONFIG.load(deps.storage)?;
    if info.sender != config.admin {
        return Err(StdError::generic_err("unauthorized"));
    }

    let source = TrustedSource {
        chain_name: chain_name.clone(),
        bridge_contract: bridge_contract.clone(),
        active: true,
    };
    TRUSTED_SOURCES.save(deps.storage, &chain_name, &source)?;

    // Add to trusted chains list
    let mut chains = TRUSTED_CHAINS.load(deps.storage)?;
    if !chains.contains(&chain_name) {
        chains.push(chain_name.clone());
        TRUSTED_CHAINS.save(deps.storage, &chains)?;
    }

    Ok(Response::new()
        .add_attribute("action", "add_trusted_source")
        .add_attribute("chain_name", chain_name)
        .add_attribute("bridge_contract", bridge_contract))
}

fn execute_remove_trusted_source(
    deps: DepsMut,
    info: MessageInfo,
    chain_name: String,
) -> StdResult<Response> {
    let config = CONFIG.load(deps.storage)?;
    if info.sender != config.admin {
        return Err(StdError::generic_err("unauthorized"));
    }

    let mut source = TRUSTED_SOURCES.load(deps.storage, &chain_name)?;
    source.active = false;
    TRUSTED_SOURCES.save(deps.storage, &chain_name, &source)?;

    Ok(Response::new()
        .add_attribute("action", "remove_trusted_source")
        .add_attribute("chain_name", chain_name))
}

fn execute_transfer_admin(
    deps: DepsMut,
    info: MessageInfo,
    new_admin: String,
) -> StdResult<Response> {
    let mut config = CONFIG.load(deps.storage)?;
    if info.sender != config.admin {
        return Err(StdError::generic_err("unauthorized"));
    }

    let new_admin_addr = deps.api.addr_validate(&new_admin)?;
    config.admin = new_admin_addr;
    CONFIG.save(deps.storage, &config)?;

    Ok(Response::new()
        .add_attribute("action", "transfer_admin")
        .add_attribute("new_admin", new_admin))
}

fn execute_set_keep_expired_receipts(
    deps: DepsMut,
    info: MessageInfo,
    keep: bool,
) -> StdResult<Response> {
    let mut config = CONFIG.load(deps.storage)?;
    if info.sender != config.admin {
        return Err(StdError::generic_err("unauthorized"));
    }

    config.keep_expired_receipts = keep;
    CONFIG.save(deps.storage, &config)?;

    Ok(Response::new()
        .add_attribute("action", "set_keep_expired_receipts")
        .add_attribute("keep", keep.to_string()))
}

fn execute_gmp(
    deps: DepsMut,
    env: Env,
    info: MessageInfo,
    source_chain: String,
    source_address: String,
    payload: Binary,
) -> StdResult<Response> {
    let config = CONFIG.load(deps.storage)?;

    // Only gateway can call this
    if info.sender != config.gateway {
        return Err(StdError::generic_err("only gateway can execute"));
    }

    // Check trusted source
    let source = TRUSTED_SOURCES
        .load(deps.storage, &source_chain)
        .map_err(|_| StdError::generic_err("untrusted source chain"))?;

    if !source.active {
        return Err(StdError::generic_err("source not active"));
    }

    if source.bridge_contract != source_address {
        return Err(StdError::generic_err("untrusted source address"));
    }

    // Decode and process payload
    process_payload(deps, env, payload)
}

fn process_payload(deps: DepsMut, env: Env, payload: Binary) -> StdResult<Response> {
    // Decode the first byte as message type
    let bytes = payload.as_slice();
    if bytes.is_empty() {
        return Err(StdError::generic_err("empty payload"));
    }

    let msg_type = bytes[0];

    match msg_type {
        0 => handle_receipt(deps, env, bytes),
        1 => handle_revocation(deps, bytes),
        _ => Err(StdError::generic_err("invalid message type")),
    }
}

fn handle_receipt(deps: DepsMut, env: Env, bytes: &[u8]) -> StdResult<Response> {
    // Decode ABI-encoded payload (simplified for CosmWasm)
    // In production, use proper ABI decoding
    let decoded: ReceiptPayload = cosmwasm_std::from_json(&bytes[1..])?;

    let expires_at = decoded.issued_at + decoded.validity_window;

    let receipt = StoredReceipt {
        holder_id: decoded.holder_id.clone(),
        policy_id: decoded.policy_id,
        snapshot_id: decoded.snapshot_id.clone(),
        chain_id_origin: decoded.chain_id_origin,
        attestation_hash: decoded.attestation_hash.clone(),
        issued_at: decoded.issued_at,
        expires_at: Uint64::from(expires_at),
        valid: true,
    };

    // Store receipt
    let receipt_key = format!(
        "{}:{}:{}",
        decoded.holder_id,
        decoded.policy_id.u64(),
        decoded.snapshot_id
    );
    RECEIPTS.save(deps.storage, &receipt_key, &receipt)?;

    // Update latest snapshot
    let hp_key = format!("{}:{}", decoded.holder_id, decoded.policy_id.u64());
    let prev_snapshot = LATEST_SNAPSHOT.may_load(deps.storage, &hp_key)?;

    if prev_snapshot.is_none() {
        // First receipt for this holder/policy
        let mut policies = HOLDER_POLICIES
            .may_load(deps.storage, &decoded.holder_id)?
            .unwrap_or_default();
        policies.push(decoded.policy_id.u64());
        HOLDER_POLICIES.save(deps.storage, &decoded.holder_id, &policies)?;
    }

    LATEST_SNAPSHOT.save(deps.storage, &hp_key, &decoded.snapshot_id)?;

    Ok(Response::new()
        .add_attribute("action", "pof_received")
        .add_attribute("holder_id", decoded.holder_id)
        .add_attribute("policy_id", decoded.policy_id.to_string())
        .add_attribute("snapshot_id", decoded.snapshot_id)
        .add_attribute("expires_at", expires_at.to_string()))
}

fn handle_revocation(deps: DepsMut, bytes: &[u8]) -> StdResult<Response> {
    let decoded: RevocationPayload = cosmwasm_std::from_json(&bytes[1..])?;

    let receipt_key = format!(
        "{}:{}:{}",
        decoded.holder_id,
        decoded.policy_id.u64(),
        decoded.snapshot_id
    );

    let mut receipt = RECEIPTS.load(deps.storage, &receipt_key)?;
    receipt.valid = false;
    RECEIPTS.save(deps.storage, &receipt_key, &receipt)?;

    Ok(Response::new()
        .add_attribute("action", "pof_revoked")
        .add_attribute("holder_id", decoded.holder_id)
        .add_attribute("policy_id", decoded.policy_id.to_string())
        .add_attribute("snapshot_id", decoded.snapshot_id))
}

#[cw_serde]
struct ReceiptPayload {
    holder_id: String,
    policy_id: Uint64,
    snapshot_id: String,
    chain_id_origin: Uint64,
    attestation_hash: String,
    validity_window: u64,
    issued_at: Uint64,
}

#[cw_serde]
struct RevocationPayload {
    holder_id: String,
    policy_id: Uint64,
    snapshot_id: String,
}

// ═══════════════════════════════════════════════════════════════════════════════
// QUERY
// ═══════════════════════════════════════════════════════════════════════════════

#[cfg_attr(not(feature = "library"), entry_point)]
pub fn query(deps: Deps, env: Env, msg: QueryMsg) -> StdResult<Binary> {
    match msg {
        QueryMsg::CheckPoF {
            holder_id,
            policy_id,
        } => to_json_binary(&query_check_pof(deps, env, holder_id, policy_id)?),
        QueryMsg::HasPoFForSnapshot {
            holder_id,
            policy_id,
            snapshot_id,
        } => to_json_binary(&query_has_pof_for_snapshot(
            deps,
            env,
            holder_id,
            policy_id,
            snapshot_id,
        )?),
        QueryMsg::GetHolderPolicies { holder_id } => {
            to_json_binary(&query_holder_policies(deps, holder_id)?)
        }
        QueryMsg::GetReceipt {
            holder_id,
            policy_id,
            snapshot_id,
        } => to_json_binary(&query_receipt(deps, holder_id, policy_id, snapshot_id)?),
        QueryMsg::GetLatestReceipt {
            holder_id,
            policy_id,
        } => to_json_binary(&query_latest_receipt(deps, holder_id, policy_id)?),
        QueryMsg::Config {} => to_json_binary(&CONFIG.load(deps.storage)?),
        QueryMsg::TrustedSources {} => to_json_binary(&query_trusted_sources(deps)?),
    }
}

fn query_check_pof(
    deps: Deps,
    env: Env,
    holder_id: String,
    policy_id: Uint64,
) -> StdResult<CheckPoFResponse> {
    let hp_key = format!("{}:{}", holder_id, policy_id.u64());
    let snapshot_id = match LATEST_SNAPSHOT.may_load(deps.storage, &hp_key)? {
        Some(id) => id,
        None => {
            return Ok(CheckPoFResponse {
                has_pof: false,
                receipt: None,
            })
        }
    };

    let receipt_key = format!("{}:{}:{}", holder_id, policy_id.u64(), snapshot_id);
    let receipt = RECEIPTS.load(deps.storage, &receipt_key)?;

    let current_time = env.block.time.seconds();
    let has_pof = receipt.valid && current_time < receipt.expires_at.u64();

    Ok(CheckPoFResponse {
        has_pof,
        receipt: Some(receipt),
    })
}

fn query_has_pof_for_snapshot(
    deps: Deps,
    env: Env,
    holder_id: String,
    policy_id: Uint64,
    snapshot_id: String,
) -> StdResult<bool> {
    let receipt_key = format!("{}:{}:{}", holder_id, policy_id.u64(), snapshot_id);

    match RECEIPTS.may_load(deps.storage, &receipt_key)? {
        Some(receipt) => {
            let current_time = env.block.time.seconds();
            Ok(receipt.valid && current_time < receipt.expires_at.u64())
        }
        None => Ok(false),
    }
}

fn query_holder_policies(deps: Deps, holder_id: String) -> StdResult<Vec<Uint64>> {
    let policies = HOLDER_POLICIES
        .may_load(deps.storage, &holder_id)?
        .unwrap_or_default();
    Ok(policies.into_iter().map(Uint64::from).collect())
}

fn query_receipt(
    deps: Deps,
    holder_id: String,
    policy_id: Uint64,
    snapshot_id: String,
) -> StdResult<StoredReceipt> {
    let receipt_key = format!("{}:{}:{}", holder_id, policy_id.u64(), snapshot_id);
    RECEIPTS.load(deps.storage, &receipt_key)
}

fn query_latest_receipt(
    deps: Deps,
    holder_id: String,
    policy_id: Uint64,
) -> StdResult<StoredReceipt> {
    let hp_key = format!("{}:{}", holder_id, policy_id.u64());
    let snapshot_id = LATEST_SNAPSHOT.load(deps.storage, &hp_key)?;
    let receipt_key = format!("{}:{}:{}", holder_id, policy_id.u64(), snapshot_id);
    RECEIPTS.load(deps.storage, &receipt_key)
}

fn query_trusted_sources(deps: Deps) -> StdResult<Vec<TrustedSource>> {
    let chains = TRUSTED_CHAINS.load(deps.storage)?;
    let mut sources = vec![];
    for chain in chains {
        if let Ok(source) = TRUSTED_SOURCES.load(deps.storage, &chain) {
            sources.push(source);
        }
    }
    Ok(sources)
}

#[cfg(test)]
mod tests {
    use super::*;
    use cosmwasm_std::testing::{mock_dependencies, mock_env, mock_info};

    #[test]
    fn test_instantiate() {
        let mut deps = mock_dependencies();
        let env = mock_env();
        let info = mock_info("admin", &[]);
        let msg = InstantiateMsg {
            gateway: "gateway".to_string(),
        };

        let res = instantiate(deps.as_mut(), env, info, msg).unwrap();
        assert_eq!(res.attributes.len(), 1);

        let config = CONFIG.load(&deps.storage).unwrap();
        assert_eq!(config.admin.as_str(), "admin");
        assert_eq!(config.gateway.as_str(), "gateway");
    }

    #[test]
    fn test_add_trusted_source() {
        let mut deps = mock_dependencies();
        let env = mock_env();
        let info = mock_info("admin", &[]);

        // Instantiate
        instantiate(
            deps.as_mut(),
            env.clone(),
            info.clone(),
            InstantiateMsg {
                gateway: "gateway".to_string(),
            },
        )
        .unwrap();

        // Add trusted source
        let msg = ExecuteMsg::AddTrustedSource {
            chain_name: "ethereum".to_string(),
            bridge_contract: "0x1234...".to_string(),
        };

        let res = execute(deps.as_mut(), env, info, msg).unwrap();
        assert_eq!(
            res.attributes
                .iter()
                .find(|a| a.key == "chain_name")
                .unwrap()
                .value,
            "ethereum"
        );
    }
}

