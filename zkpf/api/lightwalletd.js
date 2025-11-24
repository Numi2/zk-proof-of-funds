/**
 * Serverless proxy for lightwalletd gRPC-web requests.
 * This enables cross-origin isolated pages to communicate with
 * the ChainSafe lightwalletd proxy without CORS issues.
 */

const LIGHTWALLETD_URL =
  process.env.LIGHTWALLETD_URL || 'https://zcash-mainnet.chainsafe.dev';

// Headers to forward from client to lightwalletd
const FORWARD_REQUEST_HEADERS = [
  'content-type',
  'x-grpc-web',
  'x-user-agent',
  'grpc-timeout',
];

// Headers to forward from lightwalletd to client
const FORWARD_RESPONSE_HEADERS = [
  'content-type',
  'grpc-status',
  'grpc-message',
  'grpc-status-details-bin',
];

module.exports = async function handler(req, res) {
  // Handle CORS preflight
  if (req.method === 'OPTIONS') {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader(
      'Access-Control-Allow-Headers',
      'Content-Type, X-Grpc-Web, X-User-Agent, Grpc-Timeout'
    );
    res.setHeader('Access-Control-Max-Age', '86400');
    res.status(204).end();
    return;
  }

  // Set CORS headers for actual requests
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Expose-Headers', FORWARD_RESPONSE_HEADERS.join(', '));

  try {
    // Extract the path from the request
    // Vercel passes the path in req.url after the API route
    const url = new URL(req.url, `http://${req.headers.host}`);
    const targetPath = url.pathname.replace(/^\/api\/lightwalletd/, '') || '/';
    const targetUrl = `${LIGHTWALLETD_URL}${targetPath}${url.search}`;

    // Build headers to forward
    const headers = {};
    for (const header of FORWARD_REQUEST_HEADERS) {
      if (req.headers[header]) {
        headers[header] = req.headers[header];
      }
    }

    // For gRPC-web, we need to handle binary data
    let body = null;
    if (req.method === 'POST') {
      // Read raw body
      const chunks = [];
      for await (const chunk of req) {
        chunks.push(chunk);
      }
      body = Buffer.concat(chunks);
    }

    // Forward request to lightwalletd
    const response = await fetch(targetUrl, {
      method: req.method,
      headers,
      body,
    });

    // Forward response headers
    for (const header of FORWARD_RESPONSE_HEADERS) {
      const value = response.headers.get(header);
      if (value) {
        res.setHeader(header, value);
      }
    }

    // Stream response body back to client
    res.status(response.status);

    if (response.body) {
      const reader = response.body.getReader();
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        res.write(Buffer.from(value));
      }
    }
    res.end();
  } catch (err) {
    console.error('Lightwalletd proxy error:', err);
    res.status(502).json({
      error: `Failed to proxy to lightwalletd: ${err.message || 'unknown error'}`,
    });
  }
};

