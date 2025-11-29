//! SQLite database for Orchard wallet state persistence.
//!
//! This module provides database storage for:
//! - Discovered Orchard notes and their metadata
//! - Sync progress tracking
//! - Note commitment tree checkpoints

use rusqlite::{Connection, params, Result as SqliteResult};
use std::path::Path;
use tracing::{debug, info};

use crate::{NetworkKind, OrchardNoteWitness, WalletError};

/// SQLite database wrapper for Orchard wallet.
pub struct WalletDb {
    /// Database connection.
    conn: Connection,
    /// Network this database is for.
    network: NetworkKind,
}

/// Stored Orchard note record.
#[derive(Debug, Clone)]
pub struct StoredNote {
    /// Unique note ID.
    pub id: i64,
    /// Block height where the note was created.
    pub height: u32,
    /// Note value in zatoshi.
    pub value_zats: u64,
    /// Note commitment (cmx).
    pub commitment: [u8; 32],
    /// Position in the Orchard tree.
    pub position: u64,
    /// Has this note been spent?
    pub is_spent: bool,
    /// Block height where spent (if applicable).
    pub spent_height: Option<u32>,
}

impl WalletDb {
    /// Open or create a wallet database.
    ///
    /// # Arguments
    /// * `path` - Path to the SQLite database file
    /// * `network` - Network (mainnet/testnet) for validation
    pub fn open(path: impl AsRef<Path>, network: NetworkKind) -> Result<Self, WalletError> {
        let conn = Connection::open(path.as_ref())
            .map_err(|e| WalletError::Backend(format!("database open failed: {e}")))?;
        
        let db = Self { conn, network };
        db.init_schema()?;
        
        info!("Opened wallet database at {:?}", path.as_ref());
        Ok(db)
    }

    /// Create an in-memory database (for testing).
    pub fn in_memory(network: NetworkKind) -> Result<Self, WalletError> {
        let conn = Connection::open_in_memory()
            .map_err(|e| WalletError::Backend(format!("in-memory db failed: {e}")))?;
        
        let db = Self { conn, network };
        db.init_schema()?;
        
        Ok(db)
    }

    /// Initialize database schema.
    fn init_schema(&self) -> Result<(), WalletError> {
        self.conn.execute_batch(r#"
            -- Wallet metadata
            CREATE TABLE IF NOT EXISTS wallet_meta (
                key TEXT PRIMARY KEY,
                value BLOB NOT NULL
            );

            -- Sync progress
            CREATE TABLE IF NOT EXISTS sync_state (
                id INTEGER PRIMARY KEY CHECK (id = 1),
                synced_height INTEGER NOT NULL DEFAULT 0,
                tree_size INTEGER NOT NULL DEFAULT 0,
                updated_at INTEGER NOT NULL DEFAULT (strftime('%s', 'now'))
            );

            -- Initialize sync state if not exists
            INSERT OR IGNORE INTO sync_state (id, synced_height, tree_size) VALUES (1, 0, 0);

            -- Orchard notes
            CREATE TABLE IF NOT EXISTS orchard_notes (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                height INTEGER NOT NULL,
                tx_index INTEGER NOT NULL,
                action_index INTEGER NOT NULL,
                value_zats INTEGER NOT NULL,
                commitment BLOB NOT NULL UNIQUE,
                position INTEGER NOT NULL,
                nullifier BLOB,
                is_spent INTEGER NOT NULL DEFAULT 0,
                spent_height INTEGER,
                created_at INTEGER NOT NULL DEFAULT (strftime('%s', 'now'))
            );

            -- Index for fast note lookups
            CREATE INDEX IF NOT EXISTS idx_notes_height ON orchard_notes(height);
            CREATE INDEX IF NOT EXISTS idx_notes_position ON orchard_notes(position);
            CREATE INDEX IF NOT EXISTS idx_notes_commitment ON orchard_notes(commitment);
            CREATE INDEX IF NOT EXISTS idx_notes_nullifier ON orchard_notes(nullifier);

            -- Tree checkpoints for efficient rewinding
            CREATE TABLE IF NOT EXISTS tree_checkpoints (
                height INTEGER PRIMARY KEY,
                tree_state BLOB NOT NULL,
                anchor BLOB NOT NULL
            );

            -- Accounts/viewing keys
            CREATE TABLE IF NOT EXISTS accounts (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                ufvk_fingerprint BLOB NOT NULL UNIQUE,
                birthday_height INTEGER NOT NULL,
                created_at INTEGER NOT NULL DEFAULT (strftime('%s', 'now'))
            );
        "#).map_err(|e| WalletError::Backend(format!("schema init failed: {e}")))?;

        // Set network in metadata
        let network_str = match self.network {
            NetworkKind::Mainnet => "mainnet",
            NetworkKind::Testnet => "testnet",
        };
        self.conn.execute(
            "INSERT OR REPLACE INTO wallet_meta (key, value) VALUES ('network', ?)",
            params![network_str.as_bytes()],
        ).map_err(|e| WalletError::Backend(format!("set network failed: {e}")))?;

        Ok(())
    }

    /// Get the current synced height.
    pub fn synced_height(&self) -> Result<u32, WalletError> {
        let height: u32 = self.conn.query_row(
            "SELECT synced_height FROM sync_state WHERE id = 1",
            [],
            |row| row.get(0),
        ).map_err(|e| WalletError::Backend(format!("query synced_height failed: {e}")))?;
        
        Ok(height)
    }

    /// Update the synced height.
    pub fn set_synced_height(&self, height: u32, tree_size: u64) -> Result<(), WalletError> {
        self.conn.execute(
            "UPDATE sync_state SET synced_height = ?, tree_size = ?, updated_at = strftime('%s', 'now') WHERE id = 1",
            params![height, tree_size as i64],
        ).map_err(|e| WalletError::Backend(format!("update synced_height failed: {e}")))?;
        
        debug!("Updated synced height to {}", height);
        Ok(())
    }

    /// Store a discovered Orchard note.
    pub fn store_note(
        &self,
        height: u32,
        tx_index: u32,
        action_index: u32,
        value_zats: u64,
        commitment: &[u8; 32],
        position: u64,
        nullifier: Option<&[u8; 32]>,
    ) -> Result<i64, WalletError> {
        let id = self.conn.query_row(
            r#"
            INSERT INTO orchard_notes 
                (height, tx_index, action_index, value_zats, commitment, position, nullifier)
            VALUES (?, ?, ?, ?, ?, ?, ?)
            RETURNING id
            "#,
            params![
                height,
                tx_index,
                action_index,
                value_zats as i64,
                commitment.as_slice(),
                position as i64,
                nullifier.map(|n| n.as_slice()),
            ],
            |row| row.get(0),
        ).map_err(|e| WalletError::Backend(format!("store note failed: {e}")))?;

        debug!("Stored note {} at height {}, position {}", id, height, position);
        Ok(id)
    }

    /// Mark a note as spent.
    pub fn mark_spent(
        &self,
        nullifier: &[u8; 32],
        spent_height: u32,
    ) -> Result<bool, WalletError> {
        let updated = self.conn.execute(
            "UPDATE orchard_notes SET is_spent = 1, spent_height = ? WHERE nullifier = ?",
            params![spent_height, nullifier.as_slice()],
        ).map_err(|e| WalletError::Backend(format!("mark spent failed: {e}")))?;

        Ok(updated > 0)
    }

    /// Get all unspent notes at or before a given height.
    pub fn get_unspent_notes(&self, max_height: u32) -> Result<Vec<StoredNote>, WalletError> {
        let mut stmt = self.conn.prepare(
            r#"
            SELECT id, height, value_zats, commitment, position, is_spent, spent_height
            FROM orchard_notes
            WHERE is_spent = 0 AND height <= ?
            ORDER BY height ASC, position ASC
            "#,
        ).map_err(|e| WalletError::Backend(format!("prepare query failed: {e}")))?;

        let notes = stmt.query_map(params![max_height], |row| {
            let commitment_blob: Vec<u8> = row.get(3)?;
            let mut commitment = [0u8; 32];
            commitment.copy_from_slice(&commitment_blob);

            Ok(StoredNote {
                id: row.get(0)?,
                height: row.get(1)?,
                value_zats: row.get::<_, i64>(2)? as u64,
                commitment,
                position: row.get::<_, i64>(4)? as u64,
                is_spent: row.get::<_, i64>(5)? != 0,
                spent_height: row.get(6)?,
            })
        }).map_err(|e| WalletError::Backend(format!("query notes failed: {e}")))?;

        notes
            .collect::<SqliteResult<Vec<_>>>()
            .map_err(|e| WalletError::Backend(format!("collect notes failed: {e}")))
    }

    /// Get total balance of unspent notes at a height.
    pub fn get_balance(&self, max_height: u32) -> Result<u64, WalletError> {
        let balance: i64 = self.conn.query_row(
            "SELECT COALESCE(SUM(value_zats), 0) FROM orchard_notes WHERE is_spent = 0 AND height <= ?",
            params![max_height],
            |row| row.get(0),
        ).map_err(|e| WalletError::Backend(format!("query balance failed: {e}")))?;

        Ok(balance as u64)
    }

    /// Store a tree checkpoint for efficient rewinding.
    pub fn store_checkpoint(
        &self,
        height: u32,
        tree_state: &[u8],
        anchor: &[u8; 32],
    ) -> Result<(), WalletError> {
        self.conn.execute(
            "INSERT OR REPLACE INTO tree_checkpoints (height, tree_state, anchor) VALUES (?, ?, ?)",
            params![height, tree_state, anchor.as_slice()],
        ).map_err(|e| WalletError::Backend(format!("store checkpoint failed: {e}")))?;

        debug!("Stored tree checkpoint at height {}", height);
        Ok(())
    }

    /// Get the most recent checkpoint at or before a height.
    pub fn get_checkpoint(&self, max_height: u32) -> Result<Option<(u32, Vec<u8>, [u8; 32])>, WalletError> {
        let result = self.conn.query_row(
            "SELECT height, tree_state, anchor FROM tree_checkpoints WHERE height <= ? ORDER BY height DESC LIMIT 1",
            params![max_height],
            |row| {
                let height: u32 = row.get(0)?;
                let tree_state: Vec<u8> = row.get(1)?;
                let anchor_blob: Vec<u8> = row.get(2)?;
                let mut anchor = [0u8; 32];
                anchor.copy_from_slice(&anchor_blob);
                Ok((height, tree_state, anchor))
            },
        );

        match result {
            Ok(data) => Ok(Some(data)),
            Err(rusqlite::Error::QueryReturnedNoRows) => Ok(None),
            Err(e) => Err(WalletError::Backend(format!("get checkpoint failed: {e}"))),
        }
    }

    /// Get the anchor at a specific height (from checkpoint).
    pub fn get_anchor(&self, height: u32) -> Result<Option<[u8; 32]>, WalletError> {
        let result = self.conn.query_row(
            "SELECT anchor FROM tree_checkpoints WHERE height = ?",
            params![height],
            |row| {
                let anchor_blob: Vec<u8> = row.get(0)?;
                let mut anchor = [0u8; 32];
                anchor.copy_from_slice(&anchor_blob);
                Ok(anchor)
            },
        );

        match result {
            Ok(anchor) => Ok(Some(anchor)),
            Err(rusqlite::Error::QueryReturnedNoRows) => Ok(None),
            Err(e) => Err(WalletError::Backend(format!("get anchor failed: {e}"))),
        }
    }

    /// Rewind to a specific height (delete data after this height).
    pub fn rewind_to(&self, height: u32) -> Result<(), WalletError> {
        self.conn.execute(
            "DELETE FROM orchard_notes WHERE height > ?",
            params![height],
        ).map_err(|e| WalletError::Backend(format!("rewind notes failed: {e}")))?;

        self.conn.execute(
            "DELETE FROM tree_checkpoints WHERE height > ?",
            params![height],
        ).map_err(|e| WalletError::Backend(format!("rewind checkpoints failed: {e}")))?;

        self.conn.execute(
            "UPDATE sync_state SET synced_height = ? WHERE id = 1",
            params![height],
        ).map_err(|e| WalletError::Backend(format!("update sync height failed: {e}")))?;

        info!("Rewound database to height {}", height);
        Ok(())
    }

    /// Register a viewing key.
    pub fn register_account(&self, ufvk_fingerprint: &[u8; 32], birthday_height: u32) -> Result<i64, WalletError> {
        let id = self.conn.query_row(
            "INSERT INTO accounts (ufvk_fingerprint, birthday_height) VALUES (?, ?) RETURNING id",
            params![ufvk_fingerprint.as_slice(), birthday_height],
            |row| row.get(0),
        ).map_err(|e| WalletError::Backend(format!("register account failed: {e}")))?;

        info!("Registered account {} with birthday {}", id, birthday_height);
        Ok(id)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_db_init() {
        let db = WalletDb::in_memory(NetworkKind::Testnet).unwrap();
        assert_eq!(db.synced_height().unwrap(), 0);
    }

    #[test]
    fn test_store_and_retrieve_note() {
        let db = WalletDb::in_memory(NetworkKind::Testnet).unwrap();
        
        let commitment = [1u8; 32];
        let id = db.store_note(100, 0, 0, 50000, &commitment, 42, None).unwrap();
        assert!(id > 0);

        let notes = db.get_unspent_notes(100).unwrap();
        assert_eq!(notes.len(), 1);
        assert_eq!(notes[0].value_zats, 50000);
        assert_eq!(notes[0].position, 42);
    }

    #[test]
    fn test_balance() {
        let db = WalletDb::in_memory(NetworkKind::Testnet).unwrap();
        
        db.store_note(100, 0, 0, 10000, &[1u8; 32], 0, None).unwrap();
        db.store_note(101, 0, 0, 20000, &[2u8; 32], 1, None).unwrap();
        db.store_note(102, 0, 0, 30000, &[3u8; 32], 2, None).unwrap();

        assert_eq!(db.get_balance(101).unwrap(), 30000);
        assert_eq!(db.get_balance(102).unwrap(), 60000);
    }

    #[test]
    fn test_mark_spent() {
        let db = WalletDb::in_memory(NetworkKind::Testnet).unwrap();
        
        let nullifier = [99u8; 32];
        db.store_note(100, 0, 0, 10000, &[1u8; 32], 0, Some(&nullifier)).unwrap();
        
        assert_eq!(db.get_balance(100).unwrap(), 10000);
        
        db.mark_spent(&nullifier, 105).unwrap();
        
        assert_eq!(db.get_balance(110).unwrap(), 0);
    }

    #[test]
    fn test_rewind() {
        let db = WalletDb::in_memory(NetworkKind::Testnet).unwrap();
        
        db.store_note(100, 0, 0, 10000, &[1u8; 32], 0, None).unwrap();
        db.store_note(200, 0, 0, 20000, &[2u8; 32], 1, None).unwrap();
        db.set_synced_height(200, 2).unwrap();

        db.rewind_to(150).unwrap();

        assert_eq!(db.synced_height().unwrap(), 150);
        let notes = db.get_unspent_notes(200).unwrap();
        assert_eq!(notes.len(), 1);
        assert_eq!(notes[0].height, 100);
    }
}

