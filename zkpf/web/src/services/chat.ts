// Chat service wrapper around the zkpf-chat browser wasm package.
// This file provides a thin facade for creating, joining, sending and subscribing to messages.

type TicketOpts = {
	includeMyself: boolean;
	includeBootstrap: boolean;
	includeNeighbors: boolean;
};

type Message = { id: string; sender: string; content: string; nickname?: string };
export type PeerInfo = { id: string; name: string; status: 'online' | 'away' | 'offline'; lastSeen: Date };

type ChannelState = {
	channel: any;
	messages: Message[];
	subscribers: Array<(m: Message) => void>;
	peerSubscribers: Array<() => void>;
	neighborsSubscribers: Array<(n: number) => void>;
	peers: Map<string, PeerInfo>;
	neighbors: number;
	nextId: number;
	onClose: () => void;
};

// Lazy import of the wasm module to avoid breaking SSR or non-COOP/COEP contexts.
async function loadChat() {
	try {
		const mod = await import('chat-browser');
		return mod;
	} catch (error) {
		// If the module fails to load (e.g., WASM not available, wrong path, etc.),
		// log the error and throw a more descriptive error
		console.error('Failed to load chat-browser module:', error);
		throw new Error(`Chat module failed to load: ${error instanceof Error ? error.message : String(error)}`);
	}
}

class ChatServiceImpl {
	private chatNode: any | null = null;
	private channels: Map<string, ChannelState> = new Map();
	private endpointId: string | null = null;

	private async ensureNode(): Promise<void> {
		if (this.chatNode) return;
		const { ChatNode } = await loadChat();
		this.chatNode = await ChatNode.spawn();
		this.endpointId = this.chatNode.endpoint_id();
	}

	// Deterministic channel for an offer
	async createOfferChannel(offerId: string, nickname: string): Promise<{ channelId: string; ticket: string }> {
		await this.ensureNode();
		const channel = await this.chatNode.create_with_offer(offerId, nickname);
		this.ensureState(channel);
		const channelId = channel.id();
		// Build a ticket that includes us as bootstrap for the invite link
		const ticket = channel.ticket({
			includeMyself: true,
			includeBootstrap: true,
			includeNeighbors: true,
		});
		return { channelId, ticket };
	}

	// Build a deterministic ticket for an offer without creating a channel
	async ticketForOffer(offerId: string, opts: TicketOpts): Promise<string> {
		await this.ensureNode();
		return this.chatNode.ticket_for_offer(offerId, opts);
	}

	private ensureState(channel: any): ChannelState {
		const id = channel.id();
		const existing = this.channels.get(id);
		if (existing) return existing;

		let resolveClose: () => void = () => {};
		const onClosePromise = new Promise<void>((resolve) => (resolveClose = resolve));

		const state: ChannelState = {
			channel,
			messages: [],
			subscribers: [],
			peerSubscribers: [],
			neighborsSubscribers: [],
			peers: new Map(),
			neighbors: 0,
			nextId: 0,
			onClose: resolveClose,
		};
		this.channels.set(id, state);

		// Subscribe to channel events
		const subscribe = async () => {
			const reader = channel.receiver.getReader() as ReadableStreamDefaultReader<any>;
			while (true) {
				const { done, value } = await reader.read();
				if (done) break;
				const event = value;
				if (event?.type === 'messageReceived') {
					const peer: PeerInfo = {
						id: event.from,
						name: event.nickname,
						lastSeen: new Date(event.sentTimestamp / 1000),
						status: 'online',
					};
					state.peers.set(peer.id, peer);
					const message: Message = { id: String(state.nextId++), sender: event.from, content: event.text, nickname: event.nickname };
					state.messages.push(message);
					for (const sub of state.subscribers) sub(message);
					for (const sub of state.peerSubscribers) sub();
				} else if (event?.type === 'presence') {
					const peer: PeerInfo = {
						id: event.from,
						name: event.nickname,
						lastSeen: new Date(event.sentTimestamp / 1000),
						status: 'online',
					};
					state.peers.set(peer.id, peer);
					for (const sub of state.peerSubscribers) sub();
				} else if (event?.type === 'joined') {
					state.neighbors += event.neighbors?.length || 0;
					for (const sub of state.neighborsSubscribers) sub(state.neighbors);
					for (const sub of state.peerSubscribers) sub();
				} else if (event?.type === 'neighborUp') {
					state.neighbors += 1;
					for (const sub of state.neighborsSubscribers) sub(state.neighbors);
					for (const sub of state.peerSubscribers) sub();
				} else if (event?.type === 'neighborDown') {
					state.neighbors = Math.max(0, state.neighbors - 1);
					for (const sub of state.neighborsSubscribers) sub(state.neighbors);
					for (const sub of state.peerSubscribers) sub();
				}
			}
		};

		Promise.race([onClosePromise, subscribe()]);
		return state;
	}

	// Back-compat alias used by UI earlier; now deterministic
	async ensureOfferChannel(offerId: string, nickname: string): Promise<{ channelId: string; ticket: string }> {
		return this.createOfferChannel(offerId, nickname);
	}

	async tryJoinOfferChannel(offerId: string, nickname: string): Promise<string | null> {
		await this.ensureNode();
		try {
			// Attempt to join via deterministic ticket (no bootstrap)
			const ticket = await this.ticketForOffer(offerId, {
				includeMyself: false,
				includeBootstrap: false,
				includeNeighbors: false,
			});
			const channel = await this.chatNode.join(ticket, nickname);
			this.ensureState(channel);
			return channel.id();
		} catch {
			return null;
		}
	}

	async joinWithTicket(ticket: string, nickname: string): Promise<string> {
		await this.ensureNode();
		const channel = await this.chatNode.join(ticket, nickname);
		this.ensureState(channel);
		return channel.id();
	}

	getMessages(channelId: string): Message[] {
		const state = this.channels.get(channelId);
		return state ? [...state.messages] : [];
	}

	getTicket(channelId: string, opts: TicketOpts): string {
		const state = this.channels.get(channelId);
		if (!state) throw new Error('Channel not found');
		return state.channel.ticket(opts);
	}

	subscribeToMessages(channelId: string, cb: (m: Message) => void): () => void {
		const state = this.channels.get(channelId);
		if (!state) return () => {};
		state.subscribers.push(cb);
		return () => {
			state.subscribers = state.subscribers.filter((f) => f !== cb);
		};
	}

	async sendMessage(channelId: string, text: string): Promise<void> {
		const state = this.channels.get(channelId);
		if (!state) return;
		await state.channel.sender.broadcast(text);
		const message: Message = { id: String(state.nextId++), sender: this.endpointId || 'me', content: text };
		state.messages.push(message);
		for (const sub of state.subscribers) sub(message);
	}

	getPeers(channelId: string): PeerInfo[] {
		const state = this.channels.get(channelId);
		if (!state) return [];
		return Array.from(state.peers.values());
	}

	getNeighborCount(channelId: string): number {
		const state = this.channels.get(channelId);
		if (!state) return 0;
		return state.neighbors;
	}

	subscribeToPeers(channelId: string, cb: () => void): () => void {
		const state = this.channels.get(channelId);
		if (!state) return () => {};
		state.peerSubscribers.push(cb);
		return () => {
			state.peerSubscribers = state.peerSubscribers.filter((f) => f !== cb);
		};
	}

	subscribeToNeighbors(channelId: string, cb: (n: number) => void): () => void {
		const state = this.channels.get(channelId);
		if (!state) return () => {};
		// Immediately call with current value
		cb(state.neighbors);
		state.neighborsSubscribers.push(cb);
		return () => {
			state.neighborsSubscribers = state.neighborsSubscribers.filter((f) => f !== cb);
		};
	}
}

export const chatService = new ChatServiceImpl();


