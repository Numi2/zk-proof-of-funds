/**
 * P2P Payment Bridge
 * 
 * Connects P2P trades with URI payment functionality.
 * Enables generating payment links for P2P trades.
 */

import type { P2POffer, P2PTrade } from '../types/p2p';
import { 
  MAINNET_HOST, 
  encodePaymentKey,
  formatZecAmount,
} from '../components/uri-payment/utils';

/**
 * Generate a payment URI for a P2P trade
 */
export interface P2PPaymentLink {
  uri: string;
  amountZec: string;
  amountZats: number;
  keyBech32: string;
  description: string;
  tradeId?: string;
  offerId?: string;
}

/**
 * Generate a random 32-byte key
 */
function generatePaymentKey(): { keyBytes: Uint8Array; keyBech32: string } {
  const keyBytes = new Uint8Array(32);
  crypto.getRandomValues(keyBytes);
  const keyBech32 = encodePaymentKey(keyBytes, false);
  return { keyBytes, keyBech32 };
}

/**
 * Create a payment link for a P2P trade
 */
export function createPaymentLinkForTrade(trade: P2PTrade): P2PPaymentLink {
  const { keyBech32 } = generatePaymentKey();
  const amountZats = trade.zecAmountZatoshi ?? Math.floor(trade.zecAmount * 100_000_000);
  const amountStr = formatZecAmount(amountZats);
  
  const description = `P2P Trade: ${trade.zecAmount} ZEC for ${trade.exchangeValue} ${trade.exchangeCurrency}`;
  const encodedDesc = encodeURIComponent(description);
  
  const fragment = `amount=${amountStr}&desc=${encodedDesc}&key=${keyBech32}`;
  const uri = `https://${MAINNET_HOST}:65536/v1#${fragment}`;
  
  return {
    uri,
    amountZec: amountStr,
    amountZats,
    keyBech32,
    description,
    tradeId: trade.tradeId,
    offerId: trade.offerId,
  };
}

/**
 * Create a payment link for a P2P offer (for preview/sharing)
 */
export function createPaymentLinkForOffer(offer: P2POffer): P2PPaymentLink {
  const { keyBech32 } = generatePaymentKey();
  const amountZats = offer.zecAmountZatoshi ?? Math.floor(offer.zecAmount * 100_000_000);
  const amountStr = formatZecAmount(amountZats);
  
  const typeLabel = offer.offerType === 'sell' ? 'Selling' : 'Buying';
  const description = `P2P Offer: ${typeLabel} ${offer.zecAmount} ZEC for ${offer.exchangeValue} ${offer.exchangeCurrency}`;
  const encodedDesc = encodeURIComponent(description);
  
  const fragment = `amount=${amountStr}&desc=${encodedDesc}&key=${keyBech32}`;
  const uri = `https://${MAINNET_HOST}:65536/v1#${fragment}`;
  
  return {
    uri,
    amountZec: amountStr,
    amountZats,
    keyBech32,
    description,
    offerId: offer.offerId,
  };
}

/**
 * Create a custom payment link with specified amount
 */
export function createCustomPaymentLink(
  amountZec: number,
  description?: string
): P2PPaymentLink {
  const { keyBech32 } = generatePaymentKey();
  const amountZats = Math.floor(amountZec * 100_000_000);
  const amountStr = formatZecAmount(amountZats);
  
  let fragment = `amount=${amountStr}&key=${keyBech32}`;
  if (description) {
    fragment = `amount=${amountStr}&desc=${encodeURIComponent(description)}&key=${keyBech32}`;
  }
  
  const uri = `https://${MAINNET_HOST}:65536/v1#${fragment}`;
  
  return {
    uri,
    amountZec: amountStr,
    amountZats,
    keyBech32,
    description: description || `Payment of ${amountStr} ZEC`,
  };
}

/**
 * Format a payment link for sharing
 */
export function formatPaymentLinkMessage(link: P2PPaymentLink): string {
  return `🔒 ZEC Payment Link

💰 Amount: ${link.amountZec} ZEC
📝 ${link.description}

🔗 Click to receive:
${link.uri}

⚠️ Anyone with this link can claim the funds. Share carefully!`;
}

/**
 * Copy payment link to clipboard
 */
export async function copyPaymentLink(link: P2PPaymentLink): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(link.uri);
    return true;
  } catch {
    // Fallback for older browsers
    const textarea = document.createElement('textarea');
    textarea.value = link.uri;
    textarea.style.position = 'fixed';
    textarea.style.opacity = '0';
    document.body.appendChild(textarea);
    textarea.select();
    try {
      document.execCommand('copy');
      document.body.removeChild(textarea);
      return true;
    } catch {
      document.body.removeChild(textarea);
      return false;
    }
  }
}

/**
 * Share payment link via Web Share API if available
 */
export async function sharePaymentLink(link: P2PPaymentLink): Promise<boolean> {
  const text = formatPaymentLinkMessage(link);
  const title = `ZEC Payment: ${link.amountZec} ZEC`;
  
  if (navigator.share) {
    try {
      await navigator.share({
        title,
        text,
        url: link.uri,
      });
      return true;
    } catch (e) {
      if ((e as Error).name !== 'AbortError') {
        console.error('Share failed:', e);
      }
      return false;
    }
  }
  
  // Fallback: copy to clipboard
  return copyPaymentLink(link);
}

