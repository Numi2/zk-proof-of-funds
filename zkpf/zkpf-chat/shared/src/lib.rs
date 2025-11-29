use std::{
    collections::{BTreeSet, HashSet},
    sync::{Arc, Mutex},
};

use anyhow::{Context, Result};
pub use iroh::EndpointId;
use iroh::{PublicKey, SecretKey, Signature, protocol::Router};
pub use iroh_gossip::proto::TopicId;
use iroh_gossip::{
    api::{Event as GossipEvent, GossipSender},
    net::{GOSSIP_ALPN, Gossip},
};
use iroh_tickets::Ticket;
use n0_future::{
    StreamExt,
    boxed::BoxStream,
    task::{self, AbortOnDropHandle},
    time::{Duration, SystemTime},
};
use serde::{Deserialize, Serialize};
use tokio::sync::{Mutex as TokioMutex, Notify};
use tracing::{debug, info, warn};

pub const TOPIC_PREFIX: &str = "iroh-example-chat/0:";
pub const PRESENCE_INTERVAL: Duration = Duration::from_secs(5);

/// Maximum allowed length for nicknames (in bytes)
pub const MAX_NICKNAME_LENGTH: usize = 64;
/// Maximum allowed length for message text (in bytes)
pub const MAX_MESSAGE_LENGTH: usize = 4096;
/// Maximum age (in seconds) for a message to be considered valid (prevents replay of old messages)
pub const MAX_MESSAGE_AGE_SECS: u64 = 300; // 5 minutes
/// Maximum number of message IDs to track for replay protection
pub const MAX_SEEN_MESSAGES: usize = 10000;

#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct ChatTicket {
    pub topic_id: TopicId,
    pub bootstrap: BTreeSet<EndpointId>,
}

impl ChatTicket {
    pub fn new_random() -> Self {
        let topic_id = TopicId::from_bytes(rand::random());
        Self::new(topic_id)
    }

    pub fn new(topic_id: TopicId) -> Self {
        Self {
            topic_id,
            bootstrap: Default::default(),
        }
    }
    pub fn deserialize(input: &str) -> Result<Self> {
        <Self as Ticket>::deserialize(input).map_err(Into::into)
    }
    pub fn serialize(&self) -> String {
        <Self as Ticket>::serialize(self)
    }
}

impl Ticket for ChatTicket {
    const KIND: &'static str = "chat";

    fn to_bytes(&self) -> Vec<u8> {
        postcard::to_stdvec(&self).unwrap()
    }

    fn from_bytes(bytes: &[u8]) -> Result<Self, iroh_tickets::ParseError> {
        let ticket = postcard::from_bytes(bytes)?;
        Ok(ticket)
    }
}

pub struct ChatNode {
    secret_key: SecretKey,
    router: Router,
    gossip: Gossip,
}

impl ChatNode {
    /// Spawns a gossip node.
    pub async fn spawn(secret_key: Option<SecretKey>) -> Result<Self> {
        let secret_key = secret_key.unwrap_or_else(|| SecretKey::generate(&mut rand::rng()));
        let endpoint = iroh::Endpoint::builder()
            .secret_key(secret_key.clone())
            .alpns(vec![GOSSIP_ALPN.to_vec()])
            .bind()
            .await?;

        let endpoint_id = endpoint.id();
        info!("endpoint bound");
        info!("endpoint id: {endpoint_id:#?}");

        let gossip = Gossip::builder().spawn(endpoint.clone());
        info!("gossip spawned");
        let router = Router::builder(endpoint)
            .accept(GOSSIP_ALPN, gossip.clone())
            .spawn();
        info!("router spawned");
        Ok(Self {
            gossip,
            router,
            secret_key,
        })
    }

    /// Returns the endpoint id of this endpoint.
    pub fn endpoint_id(&self) -> EndpointId {
        self.router.endpoint().id()
    }

    /// Joins a chat channel from a ticket.
    ///
    /// Returns a [`ChatSender`] to send messages or change our nickname
    /// and a stream of [`Event`] items for incoming messages and other event.s
    pub async fn join(
        &self,
        ticket: &ChatTicket,
        nickname: String,
    ) -> Result<(ChatSender, BoxStream<Result<Event>>)> {
        let topic_id = ticket.topic_id;
        let bootstrap = ticket.bootstrap.iter().cloned().collect();
        info!(?bootstrap, "joining {topic_id}");
        let gossip_topic = self.gossip.subscribe(topic_id, bootstrap).await?;
        let (sender, receiver) = gossip_topic.split();

        let nickname = Arc::new(Mutex::new(nickname));
        let trigger_presence = Arc::new(Notify::new());

        // We spawn a task that occasionally sens a Presence message with our nickname.
        // This allows to track which peers are online currently.
        let sender = Arc::new(TokioMutex::new(sender));
        let presence_task = AbortOnDropHandle::new(task::spawn({
            let secret_key = self.secret_key.clone();
            let sender = sender.clone();
            let trigger_presence = trigger_presence.clone();
            let nickname = nickname.clone();

            async move {
                loop {
                    let nickname = match nickname.lock() {
                        Ok(guard) => guard.clone(),
                        Err(_) => {
                            tracing::warn!("presence task: nickname mutex poisoned");
                            break;
                        }
                    };
                    let message = Message::Presence { nickname };
                    debug!("send presence {message:?}");
                    let signed_message = match SignedMessage::sign_and_encode(&secret_key, message) {
                        Ok(msg) => msg,
                        Err(err) => {
                            tracing::warn!("presence task failed to encode message: {err}");
                            break;
                        }
                    };
                    if let Err(err) = sender.lock().await.broadcast(signed_message.into()).await {
                        tracing::warn!("presence task failed to broadcast: {err}");
                        break;
                    }
                    n0_future::future::race(
                        n0_future::time::sleep(PRESENCE_INTERVAL),
                        trigger_presence.notified(),
                    )
                    .await;
                }
            }
        }));

        // We create a stream of events, coming from the gossip topic event receiver.
        // We'll want to map the events to our own event type, which includes parsing
        // the messages and verifying the signatures, and trigger presence
        // once the swarm is joined initially.
        let replay_protection = Arc::new(Mutex::new(ReplayProtection::new()));
        let receiver = n0_future::stream::try_unfold((receiver, replay_protection), {
            let trigger_presence = trigger_presence.clone();
            move |(mut receiver, replay_protection)| {
                let trigger_presence = trigger_presence.clone();
                async move {
                    loop {
                        // Store if we were joined before the next event comes in.
                        let was_joined = receiver.is_joined();

                        // Fetch the next event.
                        let Some(event) = receiver.try_next().await? else {
                            return Ok(None);
                        };
                        // Convert into our event type with replay protection
                        let event: Event = match convert_event(event, &replay_protection) {
                            Ok(event) => event,
                            Err(err) => {
                                warn!("received invalid message: {err}");
                                continue;
                            }
                        };
                        // If we just joined, trigger sending our presence message.
                        if !was_joined && receiver.is_joined() {
                            trigger_presence.notify_waiters()
                        };

                        break Ok(Some((event, (receiver, replay_protection))));
                    }
                }
            }
        });

        let sender = ChatSender {
            secret_key: self.secret_key.clone(),
            nickname,
            sender,
            trigger_presence,
            _presence_task: Arc::new(presence_task),
        };
        Ok((sender, Box::pin(receiver)))
    }

    pub async fn shutdown(&self) {
        if let Err(err) = self.router.shutdown().await {
            warn!("failed to shutdown router cleanly: {err}");
        }
        self.router.endpoint().close().await;
    }
}

#[derive(Debug, Clone)]
pub struct ChatSender {
    nickname: Arc<Mutex<String>>,
    secret_key: SecretKey,
    sender: Arc<TokioMutex<GossipSender>>,
    trigger_presence: Arc<Notify>,
    _presence_task: Arc<AbortOnDropHandle<()>>,
}

impl ChatSender {
    pub async fn send(&self, text: String) -> Result<()> {
        // Validate message length
        if text.len() > MAX_MESSAGE_LENGTH {
            anyhow::bail!(
                "Message too long: {} bytes (max {})",
                text.len(),
                MAX_MESSAGE_LENGTH
            );
        }
        let nickname = self
            .nickname
            .lock()
            .map_err(|_| anyhow::anyhow!("nickname mutex poisoned"))?
            .clone();
        let message = Message::Message { text, nickname };
        let signed_message = SignedMessage::sign_and_encode(&self.secret_key, message)?;
        self.sender
            .lock()
            .await
            .broadcast(signed_message.into())
            .await?;
        Ok(())
    }

    pub fn set_nickname(&self, name: String) -> Result<()> {
        // Validate nickname length
        if name.len() > MAX_NICKNAME_LENGTH {
            anyhow::bail!(
                "Nickname too long: {} bytes (max {})",
                name.len(),
                MAX_NICKNAME_LENGTH
            );
        }
        let mut guard = self
            .nickname
            .lock()
            .map_err(|_| anyhow::anyhow!("nickname mutex poisoned"))?;
        *guard = name;
        drop(guard);
        self.trigger_presence.notify_waiters();
        Ok(())
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "type", rename_all = "camelCase")]
pub enum Event {
    #[serde(rename_all = "camelCase")]
    Joined {
        neighbors: Vec<EndpointId>,
    },
    #[serde(rename_all = "camelCase")]
    MessageReceived {
        from: EndpointId,
        text: String,
        nickname: String,
        sent_timestamp: u64,
    },
    #[serde(rename_all = "camelCase")]
    Presence {
        from: EndpointId,
        nickname: String,
        sent_timestamp: u64,
    },
    #[serde(rename_all = "camelCase")]
    NeighborUp {
        endpoint_id: EndpointId,
    },
    #[serde(rename_all = "camelCase")]
    NeighborDown {
        endpoint_id: EndpointId,
    },
    Lagged,
}

/// Converts a gossip event into our Event type, with replay protection for received messages
fn convert_event(
    event: GossipEvent,
    replay_protection: &Arc<Mutex<ReplayProtection>>,
) -> Result<Event> {
    let converted = match event {
        GossipEvent::NeighborUp(endpoint_id) => Event::NeighborUp { endpoint_id },
        GossipEvent::NeighborDown(endpoint_id) => Event::NeighborDown { endpoint_id },
        GossipEvent::Received(message) => {
            let mut guard = replay_protection
                .lock()
                .map_err(|_| anyhow::anyhow!("replay protection mutex poisoned"))?;
            let message = SignedMessage::verify_and_decode(&message.content, &mut guard)
                .context("failed to parse and verify signed message")?;
            drop(guard);
            match message.message {
                Message::Presence { nickname } => Event::Presence {
                    from: message.from,
                    nickname,
                    sent_timestamp: message.timestamp,
                },
                Message::Message { text, nickname } => Event::MessageReceived {
                    from: message.from,
                    text,
                    nickname,
                    sent_timestamp: message.timestamp,
                },
            }
        }
        GossipEvent::Lagged => Event::Lagged,
    };
    Ok(converted)
}

/// Unique identifier for a message, used for replay protection
pub type MessageId = [u8; 32];

#[derive(Debug, Serialize, Deserialize)]
struct SignedMessage {
    from: PublicKey,
    data: Vec<u8>,
    signature: Signature,
}

/// Computes a message ID from the signed message bytes for replay detection
fn compute_message_id(bytes: &[u8]) -> MessageId {
    use blake3::Hasher;
    let mut hasher = Hasher::new();
    hasher.update(bytes);
    let hash = hasher.finalize();
    let mut id = [0u8; 32];
    id.copy_from_slice(hash.as_bytes());
    id
}

/// Tracks seen message IDs to prevent replay attacks
#[derive(Debug, Default)]
pub struct ReplayProtection {
    seen: HashSet<MessageId>,
    // We use a Vec as a simple ring buffer for eviction
    order: Vec<MessageId>,
}

impl ReplayProtection {
    pub fn new() -> Self {
        Self::default()
    }

    /// Returns true if this message ID has been seen before (duplicate/replay)
    /// Also records the ID if it's new
    pub fn check_and_record(&mut self, id: MessageId) -> bool {
        if self.seen.contains(&id) {
            return true; // Already seen = replay
        }
        
        // Evict oldest if at capacity
        if self.seen.len() >= MAX_SEEN_MESSAGES {
            if let Some(oldest) = self.order.first().cloned() {
                self.seen.remove(&oldest);
                self.order.remove(0);
            }
        }
        
        self.seen.insert(id);
        self.order.push(id);
        false // Not seen before = fresh message
    }
}

impl SignedMessage {
    pub fn verify_and_decode(
        bytes: &[u8],
        replay_protection: &mut ReplayProtection,
    ) -> Result<ReceivedMessage> {
        // Check for replay attack first
        let message_id = compute_message_id(bytes);
        if replay_protection.check_and_record(message_id) {
            anyhow::bail!("Duplicate message detected (possible replay attack)");
        }

        let signed_message: Self = postcard::from_bytes(bytes)?;
        let key: PublicKey = signed_message.from;
        key.verify(&signed_message.data, &signed_message.signature)?;
        let message: WireMessage = postcard::from_bytes(&signed_message.data)?;
        let WireMessage::VO { timestamp, message } = message;

        // Validate timestamp is not too old (prevents replay of very old messages)
        let now = SystemTime::now()
            .duration_since(SystemTime::UNIX_EPOCH)
            .unwrap()
            .as_micros() as u64;
        let age_secs = now.saturating_sub(timestamp) / 1_000_000;
        if age_secs > MAX_MESSAGE_AGE_SECS {
            anyhow::bail!(
                "Message too old: {} seconds (max {})",
                age_secs,
                MAX_MESSAGE_AGE_SECS
            );
        }

        Ok(ReceivedMessage {
            from: signed_message.from,
            timestamp,
            message,
        })
    }

    pub fn sign_and_encode(secret_key: &SecretKey, message: Message) -> Result<Vec<u8>> {
        let timestamp = SystemTime::now()
            .duration_since(SystemTime::UNIX_EPOCH)
            .unwrap()
            .as_micros() as u64;
        let wire_message = WireMessage::VO { timestamp, message };
        let data = postcard::to_stdvec(&wire_message)?;
        let signature = secret_key.sign(&data);
        let from: PublicKey = secret_key.public();
        let signed_message = Self {
            from,
            data,
            signature,
        };
        let encoded = postcard::to_stdvec(&signed_message)?;
        Ok(encoded)
    }
}

#[derive(Debug, Serialize, Deserialize)]
pub enum WireMessage {
    VO { timestamp: u64, message: Message },
}

#[derive(Debug, Serialize, Deserialize)]
pub enum Message {
    Presence { nickname: String },
    Message { text: String, nickname: String },
}

#[derive(Debug, Serialize, Deserialize)]
pub struct ReceivedMessage {
    timestamp: u64,
    from: EndpointId,
    message: Message,
}
