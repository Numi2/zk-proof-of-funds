use std::num::NonZeroU32;
use std::str::FromStr;

use nonempty::NonEmpty;
use prost::Message;
use serde::{Deserialize, Serialize};
use wasm_bindgen::prelude::*;

use tonic_web_wasm_client::Client;

use crate::error::Error;
use crate::wallet::usk_from_seed_str;
use crate::{bindgen::proposal::Proposal, Wallet, PRUNING_DEPTH};
use wasm_thread as thread;
use webzjs_common::{Network, Pczt};
use webzjs_keys::{ProofGenerationKey, SeedFingerprint, UnifiedSpendingKey};
use zcash_address::ZcashAddress;
use zcash_client_backend::data_api::{AccountPurpose, InputSource, WalletRead, Zip32Derivation};
use zcash_client_backend::proto::service::{
    compact_tx_streamer_client::CompactTxStreamerClient, ChainSpec,
};
use zcash_client_memory::MemoryWalletDb;
use zcash_keys::encoding::AddressCodec;
use zcash_keys::keys::UnifiedFullViewingKey;
use zcash_primitives::transaction::TxId;
use zcash_primitives::zip32;

pub type MemoryWallet<T> = Wallet<MemoryWalletDb<Network>, T>;
pub type AccountId = <MemoryWalletDb<Network> as WalletRead>::AccountId;
pub type NoteRef = <MemoryWalletDb<Network> as InputSource>::NoteRef;

#[wasm_bindgen]
#[derive(Clone)]
pub struct WebWallet {
    inner: MemoryWallet<tonic_web_wasm_client::Client>,
}

impl WebWallet {
    pub fn client(&self) -> CompactTxStreamerClient<tonic_web_wasm_client::Client> {
        self.inner.client.clone()
    }

    pub fn inner_mut(&mut self) -> &mut MemoryWallet<tonic_web_wasm_client::Client> {
        &mut self.inner
    }
}

#[wasm_bindgen]
impl WebWallet {
    #[wasm_bindgen(constructor)]
    pub fn new(
        network: &str,
        lightwalletd_url: &str,
        min_confirmations: u32,
        db_bytes: Option<Box<[u8]>>,
    ) -> Result<WebWallet, Error> {
        let network = Network::from_str(network)?;
        let min_confirmations = NonZeroU32::try_from(min_confirmations)
            .map_err(|_| Error::InvalidMinConformations(min_confirmations))?;
        let client = Client::new(lightwalletd_url.to_string());

        let db = match db_bytes {
            Some(bytes) => {
                tracing::info!(
                    "Serialized db was provided to constructor. Attempting to deserialize"
                );
                MemoryWalletDb::decode_new(bytes.as_ref(), network, PRUNING_DEPTH)?
            }
            None => MemoryWalletDb::new(network, PRUNING_DEPTH),
        };

        Ok(Self {
            inner: Wallet::new(db, client, network, min_confirmations)?,
        })
    }

    pub async fn create_account(
        &self,
        account_name: &str,
        seed_phrase: &str,
        account_hd_index: u32,
        birthday_height: Option<u32>,
    ) -> Result<u32, Error> {
        tracing::info!("Create account called");
        self.inner
            .create_account(
                account_name,
                seed_phrase,
                account_hd_index,
                birthday_height,
                None,
            )
            .await
            .map(|id| *id)
    }

    pub async fn create_account_ufvk(
        &self,
        account_name: &str,
        encoded_ufvk: &str,
        seed_fingerprint: SeedFingerprint,
        account_hd_index: u32,
        birthday_height: Option<u32>,
    ) -> Result<u32, Error> {
        let ufvk = UnifiedFullViewingKey::decode(&self.inner.network, encoded_ufvk)
            .map_err(Error::KeyParse)?;
        let derivation = Some(Zip32Derivation::new(
            seed_fingerprint.into(),
            zip32::AccountId::try_from(account_hd_index)?,
        ));
        self.inner
            .import_ufvk(
                account_name,
                &ufvk,
                AccountPurpose::Spending { derivation },
                birthday_height,
                None,
            )
            .await
            .map(|id| *id)
    }

    pub async fn create_account_view_ufvk(
        &self,
        account_name: &str,
        encoded_ufvk: &str,
        birthday_height: Option<u32>,
    ) -> Result<u32, Error> {
        let ufvk = UnifiedFullViewingKey::decode(&self.inner.network, encoded_ufvk)
            .map_err(Error::KeyParse)?;

        self.inner
            .import_ufvk(
                account_name,
                &ufvk,
                AccountPurpose::ViewOnly,
                birthday_height,
                None,
            )
            .await
            .map(|id| *id)
    }

    pub async fn sync(&self) -> Result<(), Error> {
        assert!(!thread::is_web_worker_thread());

        let db = self.inner.clone();

        let sync_handler = thread::Builder::new()
            .name("sync".to_string())
            .spawn_async(|| async {
                assert!(thread::is_web_worker_thread());
                tracing::debug!(
                    "Current num threads (wasm_thread) {}",
                    rayon::current_num_threads()
                );

                let db = db;
                db.sync().await.unwrap_throw();
            })
            .unwrap_throw()
            .join_async();
        sync_handler.await.unwrap();
        Ok(())
    }

    pub async fn get_wallet_summary(&self) -> Result<Option<WalletSummary>, Error> {
        Ok(self.inner.get_wallet_summary().await?.map(Into::into))
    }

    pub async fn propose_transfer(
        &self,
        account_id: u32,
        to_address: String,
        value: u64,
    ) -> Result<Proposal, Error> {
        let to_address = ZcashAddress::try_from_encoded(&to_address)?;
        let proposal = self
            .inner
            .propose_transfer(AccountId::from(account_id), to_address, value)
            .await?;
        Ok(proposal.into())
    }

    pub async fn create_proposed_transactions(
        &self,
        proposal: Proposal,
        seed_phrase: &str,
        account_hd_index: u32,
    ) -> Result<Vec<u8>, Error> {
        assert!(!thread::is_web_worker_thread());

        let (usk, _) = usk_from_seed_str(seed_phrase, account_hd_index, &self.inner.network)?;
        let db = self.inner.clone();

        let sync_handler = thread::Builder::new()
            .name("create_proposed_transaction".to_string())
            .spawn_async(|| async move {
                assert!(thread::is_web_worker_thread());
                tracing::debug!(
                    "Current num threads (wasm_thread) {}",
                    rayon::current_num_threads()
                );

                let db = db;
                let txids = db
                    .create_proposed_transactions(proposal.into(), &usk)
                    .await
                    .unwrap_throw();
                return txids;
            })
            .unwrap_throw()
            .join_async();
        let txids = sync_handler.await.unwrap();

        let flattened_txid_bytes = txids.iter().flat_map(|&x| x.as_ref().clone()).collect();
        Ok(flattened_txid_bytes)
    }

    pub async fn db_to_bytes(&self) -> Result<Box<[u8]>, Error> {
        let bytes = self.inner.db_to_bytes().await?;
        Ok(bytes.into_boxed_slice())
    }

    pub async fn send_authorized_transactions(&self, txids: Vec<u8>) -> Result<(), Error> {
        let txids = txids
            .chunks(32)
            .map(|txid| {
                let txid_arr: [u8; 32] = txid.try_into().map_err(|_| Error::TxIdParse)?;
                Ok(TxId::from_bytes(txid_arr))
            })
            .collect::<Result<Vec<_>, Error>>()?;
        let txids = NonEmpty::from_vec(txids).ok_or(Error::TxIdParse)?;
        self.inner.send_authorized_transactions(&txids).await
    }

    pub async fn get_current_address(&self, account_id: u32) -> Result<String, Error> {
        let db = self.inner.db.read().await;
        if let Some(address) = db.get_current_address(account_id.into())? {
            Ok(address.encode(&self.inner.network))
        } else {
            Err(Error::AccountNotFound(account_id))
        }
    }

    pub async fn pczt_shield(&self, account_id: u32) -> Result<Pczt, Error> {
        self.inner
            .pczt_shield(account_id.into())
            .await
            .map(Into::into)
    }

    pub async fn pczt_create(
        &self,
        account_id: u32,
        to_address: String,
        value: u64,
    ) -> Result<Pczt, Error> {
        let to_address = ZcashAddress::try_from_encoded(&to_address)?;
        self.inner
            .pczt_create(AccountId::from(account_id), to_address, value)
            .await
            .map(Into::into)
    }

    pub async fn pczt_prove(
        &self,
        pczt: Pczt,
        sapling_proof_gen_key: Option<ProofGenerationKey>,
    ) -> Result<Pczt, Error> {
        self.inner
            .pczt_prove(pczt.into(), sapling_proof_gen_key.map(Into::into))
            .await
            .map(Into::into)
    }

    pub async fn pczt_send(&self, pczt: Pczt) -> Result<(), Error> {
        self.inner.pczt_send(pczt.into()).await
    }

    pub fn pczt_combine(&self, pczts: Vec<Pczt>) -> Result<Pczt, Error> {
        self.inner
            .pczt_combine(pczts.into_iter().map(Into::into).collect())
            .map(Into::into)
    }

    pub async fn get_current_address_transparent(&self, account_id: u32) -> Result<String, Error> {
        let db = self.inner.db.read().await;
        if let Some(address) = db.get_current_address(account_id.into())? {
            Ok(address.transparent().unwrap().encode(&self.inner.network))
        } else {
            Err(Error::AccountNotFound(account_id))
        }
    }

    ///////////////////////////////////////////////////////////////////////////////////////
    // lightwalletd gRPC methods
    ///////////////////////////////////////////////////////////////////////////////////////

    pub async fn get_latest_block(&self) -> Result<u64, Error> {
        self.client()
            .get_latest_block(ChainSpec {})
            .await
            .map(|response| response.into_inner().height)
            .map_err(Error::from)
    }
}

#[derive(Debug, Serialize, Deserialize)]
#[wasm_bindgen(inspectable)]
pub struct WalletSummary {
    account_balances: Vec<(u32, AccountBalance)>,
    pub chain_tip_height: u32,
    pub fully_scanned_height: u32,
    // scan_progress: Option<Ratio<u64>>,
    pub next_sapling_subtree_index: u64,
    pub next_orchard_subtree_index: u64,
}

#[wasm_bindgen]
impl WalletSummary {
    #[wasm_bindgen(getter)]
    pub fn account_balances(&self) -> JsValue {
        serde_wasm_bindgen::to_value(&self.account_balances).unwrap()
    }
}

#[derive(Debug, Serialize, Deserialize)]
pub struct AccountBalance {
    pub sapling_balance: u64,
    pub orchard_balance: u64,
    pub unshielded_balance: u64,
}

impl From<zcash_client_backend::data_api::AccountBalance> for AccountBalance {
    fn from(balance: zcash_client_backend::data_api::AccountBalance) -> Self {
        AccountBalance {
            sapling_balance: balance.sapling_balance().spendable_value().into(),
            orchard_balance: balance.orchard_balance().spendable_value().into(),
            unshielded_balance: balance.unshielded().into(),
        }
    }
}

impl<T> From<zcash_client_backend::data_api::WalletSummary<T>> for WalletSummary
where
    T: std::cmp::Eq + std::hash::Hash + std::ops::Deref<Target = u32> + Clone,
{
    fn from(summary: zcash_client_backend::data_api::WalletSummary<T>) -> Self {
        let mut account_balances: Vec<_> = summary
            .account_balances()
            .iter()
            .map(|(k, v)| (*(*k).clone().deref(), (*v).into()))
            .collect();

        account_balances.sort_by(|a, b| a.0.cmp(&b.0));

        WalletSummary {
            account_balances,
            chain_tip_height: summary.chain_tip_height().into(),
            fully_scanned_height: summary.fully_scanned_height().into(),
            next_sapling_subtree_index: summary.next_sapling_subtree_index(),
            next_orchard_subtree_index: summary.next_orchard_subtree_index(),
        }
    }
}