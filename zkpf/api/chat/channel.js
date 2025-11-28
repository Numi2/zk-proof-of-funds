/**
 * Chat Channel API - Vercel Serverless Function
 *
 * Provides a minimal registry to share a zkpf-chat ticket between the two
 * parties of an offer. First-write wins to avoid races.
 *
 * Endpoints:
 * - GET /api/chat/channel?offerId=XXX -> { ticket }
 * - POST /api/chat/channel            -> { success, ticket } with body { offerId, ticket }
 */

// Simple in-memory fallback if Redis not configured
let memoryStore = new Map();
let lastCleanup = Date.now();

// Upstash Redis REST client (no SDK needed)
const UPSTASH_URL = process.env.UPSTASH_REDIS_REST_URL;
const UPSTASH_TOKEN = process.env.UPSTASH_REDIS_REST_TOKEN;

const isRedisConfigured = () => !!(UPSTASH_URL && UPSTASH_TOKEN);

async function redisCommand(command, ...args) {
	if (!isRedisConfigured()) return null;
	try {
		const response = await fetch(`${UPSTASH_URL}`, {
			method: 'POST',
			headers: {
				Authorization: `Bearer ${UPSTASH_TOKEN}`,
				'Content-Type': 'application/json',
			},
			body: JSON.stringify([command, ...args]),
		});
		if (!response.ok) return null;
		const data = await response.json();
		return data.result;
	} catch (e) {
		console.error('Redis command failed:', e);
		return null;
	}
}

const CHANNELS_KEY = 'p2p_chat_channels_v1';
const CHANNEL_TTL = 3 * 24 * 60 * 60; // 3 days in seconds

function cleanupMemoryStore() {
	const now = Date.now();
	if (now - lastCleanup < 60000) return; // once per minute
	lastCleanup = now;
	for (const [offerId, entry] of memoryStore) {
		if (entry.expires && entry.expires < now) {
			memoryStore.delete(offerId);
		}
	}
}

export default async function handler(req, res) {
	// CORS
	res.setHeader('Access-Control-Allow-Origin', '*');
	res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
	res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
	if (req.method === 'OPTIONS') {
		return res.status(200).end();
	}

	try {
		if (req.method === 'GET') {
			const offerId = req.query.offerId;
			if (!offerId) {
				return res.status(400).json({ error: 'Missing offerId' });
			}

			if (isRedisConfigured()) {
				const existing = await redisCommand('HGET', CHANNELS_KEY, offerId);
				if (!existing) return res.status(404).json({ error: 'Not found' });
				const { ticket } = typeof existing === 'string' ? JSON.parse(existing) : existing;
				return res.status(200).json({ ticket, storage: 'redis' });
			} else {
				cleanupMemoryStore();
				const entry = memoryStore.get(offerId);
				if (!entry) return res.status(404).json({ error: 'Not found' });
				return res.status(200).json({ ticket: entry.ticket, storage: 'memory' });
			}
		}

		if (req.method === 'POST') {
			const body = typeof req.body === 'string' ? JSON.parse(req.body) : req.body;
			const { offerId, ticket } = body || {};
			if (!offerId || !ticket) {
				return res.status(400).json({ error: 'Missing offerId or ticket' });
			}

			if (isRedisConfigured()) {
				// First-write wins semantics: only set if not present
				const exists = await redisCommand('HEXISTS', CHANNELS_KEY, offerId);
				if (!exists) {
					await redisCommand('HSET', CHANNELS_KEY, offerId, JSON.stringify({ ticket, createdAt: Date.now() }));
					await redisCommand('EXPIRE', CHANNELS_KEY, CHANNEL_TTL);
					return res.status(200).json({ success: true, ticket, storage: 'redis', created: true });
				} else {
					const existing = await redisCommand('HGET', CHANNELS_KEY, offerId);
					const parsed = typeof existing === 'string' ? JSON.parse(existing) : existing;
					return res.status(200).json({ success: true, ticket: parsed.ticket, storage: 'redis', created: false });
				}
			} else {
				cleanupMemoryStore();
				if (!memoryStore.has(offerId)) {
					memoryStore.set(offerId, { ticket, createdAt: Date.now(), expires: Date.now() + CHANNEL_TTL * 1000 });
					return res.status(200).json({ success: true, ticket, storage: 'memory', created: true });
				} else {
					const existing = memoryStore.get(offerId);
					return res.status(200).json({ success: true, ticket: existing.ticket, storage: 'memory', created: false });
				}
			}
		}

		return res.status(405).json({ error: 'Method not allowed' });
	} catch (error) {
		console.error('Chat Channel API error:', error);
		return res.status(500).json({ error: 'Internal server error' });
	}
}


