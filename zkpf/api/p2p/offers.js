/**
 * P2P Offers API - Vercel Serverless Function
 * 
 * Provides real-time syncing of P2P offers across all users.
 * Uses Upstash Redis for persistent storage.
 * 
 * Setup:
 * 1. Go to Vercel Dashboard > Storage > Add Integration > Upstash
 * 2. Create a Redis database
 * 3. Connect it to this project - env vars are auto-added:
 *    - UPSTASH_REDIS_REST_URL
 *    - UPSTASH_REDIS_REST_TOKEN
 * 
 * Endpoints:
 * - GET /api/p2p/offers - List all active offers
 * - POST /api/p2p/offers - Add or update an offer
 * - DELETE /api/p2p/offers?id=xxx - Remove an offer
 */

// Simple in-memory fallback if Redis not configured
let memoryStore = new Map();
let lastCleanup = Date.now();

// Upstash Redis REST client (no SDK needed)
const UPSTASH_URL = process.env.UPSTASH_REDIS_REST_URL;
const UPSTASH_TOKEN = process.env.UPSTASH_REDIS_REST_TOKEN;

const isRedisConfigured = () => !!(UPSTASH_URL && UPSTASH_TOKEN);

// Simple Redis REST client
async function redisCommand(command, ...args) {
  if (!isRedisConfigured()) return null;
  
  try {
    const response = await fetch(`${UPSTASH_URL}`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${UPSTASH_TOKEN}`,
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

const OFFERS_KEY = 'p2p_offers_v1';
const OFFER_TTL = 7 * 24 * 60 * 60; // 7 days in seconds

// Cleanup expired offers from memory store
function cleanupMemoryStore() {
  const now = Date.now();
  if (now - lastCleanup < 60000) return; // Only cleanup every minute
  lastCleanup = now;
  
  for (const [id, offer] of memoryStore) {
    if (offer.expires && offer.expires < now) {
      memoryStore.delete(id);
    }
  }
}

export default async function handler(req, res) {
  // CORS headers
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  
  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  try {
    if (req.method === 'GET') {
      // List all offers
      let offers = [];
      
      if (isRedisConfigured()) {
        // Get from Upstash Redis
        const stored = await redisCommand('HGETALL', OFFERS_KEY);
        if (stored && Array.isArray(stored)) {
          const now = Date.now();
          // HGETALL returns [key1, val1, key2, val2, ...]
          for (let i = 0; i < stored.length; i += 2) {
            try {
              const offer = typeof stored[i + 1] === 'string' 
                ? JSON.parse(stored[i + 1]) 
                : stored[i + 1];
              if (offer && offer.active !== false && (!offer.expires || offer.expires > now)) {
                offers.push(offer);
              }
            } catch (e) {
              // Invalid JSON, skip
            }
          }
        }
      } else {
        // Get from memory store
        cleanupMemoryStore();
        const now = Date.now();
        offers = Array.from(memoryStore.values())
          .filter(o => o.active !== false)
          .filter(o => !o.expires || o.expires > now);
      }
      
      return res.status(200).json({ offers, storage: isRedisConfigured() ? 'redis' : 'memory' });
    }
    
    if (req.method === 'POST') {
      // Add or update an offer
      const offer = typeof req.body === 'string' ? JSON.parse(req.body) : req.body;
      
      if (!offer || !offer.id) {
        return res.status(400).json({ error: 'Invalid offer data' });
      }
      
      offer.updatedAt = Date.now();
      offer.active = true;
      
      if (isRedisConfigured()) {
        await redisCommand('HSET', OFFERS_KEY, offer.id, JSON.stringify(offer));
        await redisCommand('EXPIRE', OFFERS_KEY, OFFER_TTL);
      } else {
        memoryStore.set(offer.id, offer);
      }
      
      return res.status(200).json({ success: true, offer, storage: isRedisConfigured() ? 'redis' : 'memory' });
    }
    
    if (req.method === 'DELETE') {
      // Remove an offer
      const { id } = req.query;
      
      if (!id) {
        return res.status(400).json({ error: 'Missing offer id' });
      }
      
      if (isRedisConfigured()) {
        // Get existing offer
        const existing = await redisCommand('HGET', OFFERS_KEY, id);
        if (existing) {
          const offer = typeof existing === 'string' ? JSON.parse(existing) : existing;
          offer.active = false;
          await redisCommand('HSET', OFFERS_KEY, id, JSON.stringify(offer));
        }
      } else {
        const existing = memoryStore.get(id);
        if (existing) {
          memoryStore.set(id, { ...existing, active: false });
        }
      }
      
      return res.status(200).json({ success: true });
    }
    
    return res.status(405).json({ error: 'Method not allowed' });
  } catch (error) {
    console.error('P2P Offers API error:', error);
    return res.status(500).json({ error: 'Internal server error' });
  }
}

