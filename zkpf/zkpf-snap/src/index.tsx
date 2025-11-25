import type { OnRpcRequestHandler, OnInstallHandler } from '@metamask/snaps-sdk';
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
import type { PolicyDefinition, FundingSource } from './types';

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

/**
 * Handle incoming JSON-RPC requests sent through `wallet_invokeSnap`.
 * 
 * Supported methods:
 * - selectPolicy: Select a policy to prove against
 * - addEthereumSource: Auto-populate with connected ETH address
 * - addZcashSource: Collect Zcash UFVK via dialogs
 * - addFundingSource: Add a custom funding source
 * - getFundingSources: Get current funding sources
 * - clearFundingSources: Clear all funding sources
 * - bindHolder: Sign message and generate holder_tag
 * - bindHolderTypedData: Alternative EIP-712 binding
 * - createProof: Complete proof generation flow
 * - getProofState: Get current proof state
 * - resetProofState: Clear all state
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
      // Complete Flow: Create Proof
      // ========================================
      case 'createProof': {
        assert(request.params, object({ policy: PolicySchema }));
        const { policy } = request.params as { policy: PolicyDefinition };
        return await createProof(policy, origin);
      }

      // ========================================
      // State Management
      // ========================================
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
 * Handle snap installation
 */
export const onInstall: OnInstallHandler = async () => {
  await installDialog();
};

