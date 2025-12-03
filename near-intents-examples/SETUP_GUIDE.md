# NEAR Intents Examples - Setup Guide

## ✅ Installation Complete

The project has been cloned and dependencies installed successfully.

## 🔧 Environment Setup

Create a `.env` file in the root directory (`near-intents-examples/.env`) with the following content:

```env
SENDER_NEAR_ACCOUNT=your-account.near
SENDER_PRIVATE_KEY=ed25519:your_near_private_key
ONE_CLICK_JWT=your_json_web_token
```

### Environment Variables Explained:

1. **SENDER_NEAR_ACCOUNT**: Your NEAR account ID (e.g., `your-account.near`)
2. **SENDER_PRIVATE_KEY**: Your NEAR private key in ed25519 format (e.g., `ed25519:5D9PZd2a...`)
3. **ONE_CLICK_JWT**: (Optional) JSON Web Token for 1-Click API
   - Request one here: https://docs.google.com/forms/d/e/1FAIpQLSdrSrqSkKOMb_a8XhwF0f7N5xZ0Y5CYgyzxiAuoC2g4a2N68g/viewform
   - **Note**: Without JWT, you will incur a 0.1% fee on all swaps

## 📝 Swap Configuration

Swap quotes can be configured in:
- `1click-example/2-get-quote.ts` - For individual quote requests
- `1click-example/6-full-swap.ts` - For complete swap execution

### Example Swap Configuration:

```typescript
const isTest = true;  // set to true for quote estimation / testing, false for actual execution
const senderAddress = process.env.SENDER_NEAR_ACCOUNT as string;
const recipientAddress = '0x553e771500f2d7529079918F93d86C0a845B540b';  // Token swap recipient address on Arbitrum
const originAsset = "nep141:wrap.near";  // Native $NEAR
const destinationAsset = "nep141:arb-0x912ce59144191c1204e64559fe8253a0e49e6548.omft.near";  // Native $ARB
const amount = NEAR.toUnits("0.1").toString();  // 0.1 $NEAR
```

## 🎯 Available Commands

### Step 1: Get Available Tokens
```bash
pnpm getTokens
```
Fetches all supported tokens across different blockchains. No authentication required.

### Step 2: Get Quote
```bash
pnpm getQuote
```
Retrieves swap quotes with pricing and fees. Generates unique deposit addresses.

### Step 3: Send Deposit
```bash
pnpm sendDeposit
```
Sends tokens to the generated deposit address. **Note**: Update `depositAddress` in `3-send-deposit.ts` first.

### Step 4: Check Status (Optional)
```bash
pnpm checkStatus
```
Monitors swap execution status. **Note**: Update `depositAddress` in `5-check-status-OPTIONAL.ts` first.

### Step 5: Full Swap (Complete Flow)
```bash
pnpm fullSwap
```
Combines steps 2-4 into one seamless process with automatic status monitoring.

## 📚 Project Structure

```
1click-example/
├── 1-get-tokens.ts              # Fetch supported networks and tokens
├── 2-get-quote.ts               # Get swap quotes
├── 3-send-deposit.ts            # Send deposit transaction
├── 4-submit-tx-hash-OPTIONAL.ts # Submit transaction hash (optional)
├── 5-check-status-OPTIONAL.ts  # Monitor swap status (optional)
├── 6-full-swap.ts               # Execute complete swap flow
├── near.ts                      # NEAR account utilities
└── utils.ts                     # Helper functions
```

## 🔍 Swap Flow

1. **Quote Generation**: Get token swap pricing quote with a `depositAddress`
2. **Token Deposit**: Send agreed upon token amount to the `depositAddress`
3. **Intent Execution**: 1Click executes swap on specified chain(s) w/ NEAR Intents

## 📊 Status Monitoring

The system tracks swaps through these stages:
- `PENDING_DEPOSIT`: Waiting for deposit confirmation
- `KNOWN_DEPOSIT_TX`: Deposit transaction detected
- `PROCESSING`: Swap being executed
- `SUCCESS`: Swap completed successfully
- `REFUNDED`: Swap failed, tokens refunded

## 🔗 Useful Links

- [1-Click API Docs](https://docs.near-intents.org/near-intents/integration/distribution-channels/1click-api)
- [1-Click TypeScript SDK Repo](https://github.com/defuse-protocol/one-click-sdk-typescript)
- [NEAR Intents Explorer](https://explorer.near-intents.org)
- [NEAR Protocol Documentation](https://docs.near.org)

## ⚠️ Important Notes

1. Make sure you have sufficient NEAR balance (~0.05 $NEAR) for gas fees
2. The JWT token is optional but recommended to avoid the 0.1% fee
3. When running individual steps (3, 4), make sure to update the `depositAddress` variable in the respective files
4. For testing, set `isTest = true` in the configuration files
5. For actual execution, set `isTest = false` in `6-full-swap.ts`

