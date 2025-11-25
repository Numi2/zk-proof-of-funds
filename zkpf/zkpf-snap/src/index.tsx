import type { OnRpcRequestHandler, OnInstallHandler, OnUserInputHandler } from '@metamask/snaps-sdk';
import { UserInputEventType } from '@metamask/snaps-sdk';
import { assert, object, string, number, array, optional, enums, type, nullable } from 'superstruct';

import { installDialog, errorDialog } from './ui/dialogs';
import { selectPolicy } from './rpc/selectPolicy';
import { 
  addFundingSource, 
  getConnectedEthereumAccount,
  collectZcashSource,
  clearFundingSources,
  getFundingSources,
} from './rpc/addFundingSource';
import { bindHolder, bindHolderTypedData } from './rpc/bindHolder';
import { createProof, getProofState, resetProofState } from './rpc/createProof';
import { exportProofBundle, parseProofBundle } from './rpc/exportBundle';
import { verifyProofBundle, verifyBundleInteractive } from './rpc/verifyBundle';
import { 
  listProofHistory, 
  getProofFromHistory, 
  clearProofHistoryWithConfirmation,
  showProofHistoryDialog,
  markProofVerified,
} from './rpc/proofHistory';
import { 
  getCurrentNetwork, 
  switchNetwork, 
  getZcashNetwork, 
  getEthereumChainId,
  isMainnet,
} from './rpc/networkConfig';
import {
  getOrCreateHolderFingerprint,
  showHolderFingerprint,
  getExistingHolderFingerprint,
} from './rpc/holderFingerprint';
import { getSnapState, setSnapState, clearSnapState } from './utils/state';
import type { PolicyDefinition, FundingSource, ProofRequest, NetworkType, SnapState } from './types';

// Validation schemas
const PolicySchema = object({
  policy_id: number(),
  verifier_scope_id: number(),
  threshold_raw: number(),
  required_currency_code: number(),
  // These fields may be omitted or explicitly null in backend responses.
  category: optional(nullable(string())),
  rail_id: optional(nullable(string())),
  label: optional(nullable(string())),
});

const EthereumSourceSchema = object({
  type: enums(['ethereum']),
  address: string(),
  chainId: string(),
  balanceWei: optional(string()),
});

const ZcashSourceSchema = object({
  type: enums(['zcash']),
  ufvk: string(),
  network: enums(['main', 'test']),
  snapshotHeight: optional(number()),
  balanceZats: optional(number()),
});

const FundingSourceSchema = type({
  type: enums(['ethereum', 'zcash']),
});

const ProofRequestSchema = object({
  policy: PolicySchema,
  fundingSources: array(FundingSourceSchema),
  holderBinding: object({
    signature: string(),
    holderTag: string(),
    signerAddress: string(),
    message: string(),
  }),
  timestamp: number(),
});

/**
 * Handle incoming JSON-RPC requests sent through `wallet_invokeSnap`.
 * 
 * Supported methods:
 * 
 * == Policy Selection ==
 * - selectPolicy: Select a policy to prove against
 * 
 * == Funding Sources ==
 * - addEthereumSource: Auto-populate with connected ETH address
 * - addZcashSource: Collect Zcash UFVK via dialogs
 * - addFundingSource: Add a custom funding source
 * - getFundingSources: Get current funding sources
 * - clearFundingSources: Clear all funding sources
 * 
 * == Holder Identity ==
 * - bindHolder: Sign message and generate holder_tag
 * - bindHolderTypedData: Alternative EIP-712 binding
 * - getHolderFingerprint: Get or create persistent holder fingerprint
 * - showHolderFingerprint: Display fingerprint in dialog
 * 
 * == Proof Generation ==
 * - createProof: Complete proof generation flow
 * - exportProofBundle: Export proof as shareable bundle
 * 
 * == Verification ==
 * - verifyProofBundle: Verify a proof bundle JSON
 * - verifyBundleInteractive: Prompt user for bundle and verify
 * 
 * == Proof History ==
 * - listProofHistory: Get all proof history entries
 * - getProofFromHistory: Get specific proof by bundle ID
 * - showProofHistory: Display history in dialog
 * - clearProofHistory: Clear all history with confirmation
 * - markProofVerified: Mark a proof as verified
 * 
 * == Network ==
 * - getCurrentNetwork: Get current network configuration
 * - switchNetwork: Switch to mainnet/testnet
 * - getZcashNetwork: Get current Zcash network
 * - getEthereumChainId: Get current Ethereum chain ID
 * - isMainnet: Check if currently on mainnet
 * 
 * == State Management ==
 * - getSnapState: Get raw snap state
 * - setSnapState: Update snap state
 * - clearSnapState: Clear all state
 * - getProofState: Get current proof generation state
 * - resetProofState: Clear proof state
 */
export const onRpcRequest: OnRpcRequestHandler = async ({ request, origin }) => {
  try {
    switch (request.method) {
      // ========================================
      // Step 1: Choose Policy
      // ========================================
      case 'selectPolicy': {
        assert(request.params, object({ policy: PolicySchema }));
        const { policy } = request.params as { policy: PolicyDefinition };
        return await selectPolicy(policy, origin);
      }

      // ========================================
      // Step 2: Select Funding Sources
      // ========================================
      case 'addEthereumSource': {
        // Auto-populate with connected ETH address
        const ethSource = await getConnectedEthereumAccount();
        return await addFundingSource(ethSource, origin);
      }

      case 'addZcashSource': {
        // Collect Zcash UFVK via dialogs
        const zcashSource = await collectZcashSource();
        if (!zcashSource) {
          throw new Error('User cancelled Zcash source input');
        }
        return await addFundingSource(zcashSource, origin);
      }

      case 'addFundingSource': {
        assert(request.params, object({ source: FundingSourceSchema }));
        const { source } = request.params as { source: FundingSource };
        
        // Validate based on type
        if (source.type === 'ethereum') {
          assert(source, EthereumSourceSchema);
        } else if (source.type === 'zcash') {
          assert(source, ZcashSourceSchema);
        }
        
        return await addFundingSource(source, origin);
      }

      case 'getFundingSources': {
        return await getFundingSources();
      }

      case 'clearFundingSources': {
        await clearFundingSources();
        return { success: true };
      }

      // ========================================
      // Step 3: Bind Holder Identity
      // ========================================
      case 'bindHolder': {
        assert(request.params, object({ 
          policy: PolicySchema,
          fundingSources: optional(array(FundingSourceSchema)),
        }));
        const params = request.params as { 
          policy: PolicyDefinition; 
          fundingSources?: FundingSource[];
        };
        
        // Use provided sources or get from state
        const sources = params.fundingSources ?? await getFundingSources();
        return await bindHolder(params.policy, sources, origin);
      }

      case 'bindHolderTypedData': {
        assert(request.params, object({ 
          policy: PolicySchema,
          fundingSources: optional(array(FundingSourceSchema)),
        }));
        const params = request.params as { 
          policy: PolicyDefinition; 
          fundingSources?: FundingSource[];
        };
        
        const sources = params.fundingSources ?? await getFundingSources();
        return await bindHolderTypedData(params.policy, sources, origin);
      }

      // ========================================
      // Holder Fingerprint
      // ========================================
      case 'getHolderFingerprint': {
        return await getOrCreateHolderFingerprint();
      }

      case 'showHolderFingerprint': {
        return await showHolderFingerprint();
      }

      case 'getExistingHolderFingerprint': {
        return await getExistingHolderFingerprint();
      }

      // ========================================
      // Complete Flow: Create Proof
      // ========================================
      case 'createProof': {
        assert(request.params, object({ policy: PolicySchema }));
        const { policy } = request.params as { policy: PolicyDefinition };
        return await createProof(policy, origin);
      }

      // ========================================
      // Export & Share
      // ========================================
      case 'exportProofBundle': {
        assert(request.params, object({ proofRequest: ProofRequestSchema }));
        const { proofRequest } = request.params as { proofRequest: ProofRequest };
        return await exportProofBundle(proofRequest);
      }

      // ========================================
      // Verification
      // ========================================
      case 'verifyProofBundle': {
        assert(request.params, object({ bundleJson: string() }));
        const { bundleJson } = request.params as { bundleJson: string };
        return await verifyProofBundle(bundleJson);
      }

      case 'verifyBundleInteractive': {
        return await verifyBundleInteractive();
      }

      case 'parseProofBundle': {
        assert(request.params, object({ bundleJson: string() }));
        const { bundleJson } = request.params as { bundleJson: string };
        return parseProofBundle(bundleJson);
      }

      // ========================================
      // Proof History
      // ========================================
      case 'listProofHistory': {
        return await listProofHistory();
      }

      case 'getProofFromHistory': {
        assert(request.params, object({ bundleId: string() }));
        const { bundleId } = request.params as { bundleId: string };
        return await getProofFromHistory(bundleId);
      }

      case 'showProofHistory': {
        await showProofHistoryDialog();
        return { success: true };
      }

      case 'clearProofHistory': {
        const cleared = await clearProofHistoryWithConfirmation();
        return { success: cleared };
      }

      case 'markProofVerified': {
        assert(request.params, object({ bundleId: string(), verified: optional(enums([true, false])) }));
        const { bundleId, verified = true } = request.params as { bundleId: string; verified?: boolean };
        const success = await markProofVerified(bundleId, verified);
        return { success };
      }

      // ========================================
      // Network Configuration
      // ========================================
      case 'getCurrentNetwork': {
        return await getCurrentNetwork();
      }

      case 'switchNetwork': {
        assert(request.params, object({ network: enums(['mainnet', 'testnet']) }));
        const { network } = request.params as { network: NetworkType };
        return await switchNetwork(network);
      }

      case 'getZcashNetwork': {
        return await getZcashNetwork();
      }

      case 'getEthereumChainId': {
        return await getEthereumChainId();
      }

      case 'isMainnet': {
        return await isMainnet();
      }

      // ========================================
      // State Management
      // ========================================
      case 'getSnapState': {
        return await getSnapState();
      }

      case 'setSnapState': {
        const params = request.params as Partial<SnapState>;
        return await setSnapState(params);
      }

      case 'clearSnapState': {
        await clearSnapState();
        return { success: true };
      }

      case 'getProofState': {
        return await getProofState();
      }

      case 'resetProofState': {
        await resetProofState();
        return { success: true };
      }

      default:
        throw new Error(`Method not found: ${request.method}`);
    }
  } catch (error) {
    // Show error dialog for user-facing errors
    if (error instanceof Error && !error.message.includes('User rejected')) {
      await errorDialog('Error', error.message);
    }
    throw error;
  }
};

/**
 * Handle user input events from interactive dialogs
 */
export const onUserInput: OnUserInputHandler = async ({ id, event }) => {
  // Handle form submissions - use the enum value for type comparison
  if (event.type === UserInputEventType.FormSubmitEvent) {
    switch (event.name) {
      case 'verify-bundle-form':
      case 'ufvk-input-form':
      case 'snapshot-height-form':
        await snap.request({
          method: 'snap_resolveInterface',
          params: {
            id,
            value: event.value,
          },
        });
        break;
      default:
        break;
    }
  }
};

/**
 * Handle snap installation
 */
export const onInstall: OnInstallHandler = async () => {
  await installDialog();
};

