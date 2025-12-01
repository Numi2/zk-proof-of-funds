# @numi2/x402-zec

**x402 Payment Required SDK for Zcash (ZEC)**

Accept private ZEC payments in your API using the HTTP 402 Payment Required protocol.

## Installation

```bash
npm install @numi2/x402-zec
# or
yarn add @numi2/x402-zec
```

## Quick Start

### Vanilla JavaScript/TypeScript

```typescript
import { X402Client, formatZec, generatePaymentUri } from '@numi2/x402-zec';

const client = new X402Client({
  onPaymentRequired: async (requirements) => {
    // Show payment dialog to user
    console.log(`Pay ${formatZec(requirements.amount_zatoshis)} to ${requirements.address}`);
    
    // Open wallet app
    const uri = generatePaymentUri(requirements);
    window.open(uri);
    
    // Get txid from user
    const txid = prompt('Enter transaction ID after payment:');
    return txid;
  }
});

// All fetch calls auto-handle 402 responses
const response = await client.fetch('/api/premium-endpoint');
const data = await response.json();
```

### React

```tsx
import { X402Provider, useX402Fetch } from '@numi2/x402-zec/react';

// 1. Wrap your app with the provider
function App() {
  return (
    <X402Provider>
      <MyApp />
    </X402Provider>
  );
}

// 2. Use the hook in your components
function PremiumContent() {
  const x402Fetch = useX402Fetch();

  const loadContent = async () => {
    const response = await x402Fetch('/api/premium');
    const data = await response.json();
    console.log(data);
  };

  return <button onClick={loadContent}>Load Premium Content</button>;
}
```

## API Reference

### `X402Client`

Main client for making x402-aware HTTP requests.

```typescript
const client = new X402Client({
  // Required: Handle payment requests
  onPaymentRequired: async (requirements) => {
    // Return txid string or null to cancel
    return 'transaction-id-here';
  },
  
  // Optional: Handle pending payments
  onPaymentPending: (requirements, confirmations) => {
    console.log(`Waiting for ${confirmations} confirmations`);
  },
  
  // Optional: Error handler
  onError: (error) => console.error(error),
  
  // Optional: Max retry attempts (default: 5)
  maxRetries: 5,
  
  // Optional: Retry delay in ms (default: 2000)
  retryDelay: 2000,
  
  // Optional: Base URL for all requests
  baseUrl: 'https://api.example.com',
  
  // Optional: Custom headers
  headers: { 'X-Custom': 'value' }
});

// Make requests
const response = await client.fetch('/endpoint');
```

### Utility Functions

```typescript
import {
  formatZec,          // Format zatoshis for display
  zatoshisToZec,      // Convert zatoshis to ZEC
  zecToZatoshis,      // Convert ZEC to zatoshis
  generatePaymentUri, // Create zcash: URI for wallets
  isValidTxid,        // Validate transaction ID format
  isExpired,          // Check if payment request expired
  getTimeRemaining    // Get seconds until expiration
} from '@numi2/x402-zec';

// Examples
formatZec(100000);           // "0.001 ZEC"
zatoshisToZec(100000000);    // 1.0
zecToZatoshis(0.5);          // 50000000
isValidTxid('abc123...');    // true/false
```

### React Components

```typescript
import {
  X402Provider,        // Context provider
  useX402,             // Access x402 context
  useX402Fetch,        // Make x402 fetch calls
  usePaymentInfo,      // Get payment info for a URL
  DefaultPaymentModal  // Default payment UI
} from '@numi2/x402-zec/react';
```

## Payment Requirements

When a 402 response is received, the `onPaymentRequired` callback receives:

```typescript
interface PaymentRequirements {
  version: string;                    // Protocol version
  scheme: 'zcash:sapling' | 'zcash:transparent' | 'zcash:unified';
  address: string;                    // Zcash receiving address
  amount_zatoshis: number;            // Amount in zatoshis (1 ZEC = 100000000)
  network: 'mainnet' | 'testnet';
  expires_at: string;                 // ISO timestamp
  min_confirmations: number;          // Required block confirmations
  resource: string;                   // API endpoint being accessed
  description?: string;               // Human-readable description
  payment_id?: string;                // Unique payment identifier
  memo?: string;                      // Optional memo for transaction
}
```

## Custom Payment Modal

```tsx
import { X402Provider, PaymentModalProps } from '@numi2/x402-zec/react';

function MyPaymentModal({ requirements, onSubmit, onCancel }: PaymentModalProps) {
  return (
    <div className="my-modal">
      <h2>Pay {formatZec(requirements.amount_zatoshis)}</h2>
      <p>Address: {requirements.address}</p>
      <input 
        placeholder="Transaction ID" 
        onKeyDown={(e) => e.key === 'Enter' && onSubmit(e.target.value)}
      />
      <button onClick={onCancel}>Cancel</button>
    </div>
  );
}

// Use custom modal
<X402Provider PaymentModal={MyPaymentModal}>
  <App />
</X402Provider>
```

## License

MIT - Numan Thabit

