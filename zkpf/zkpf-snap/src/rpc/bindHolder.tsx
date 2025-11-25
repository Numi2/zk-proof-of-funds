import type { HolderBinding, PolicyDefinition, FundingSource } from '../types';
import { confirmHolderBindingDialog } from '../ui/dialogs';
import { computeHolderTag, hashFundingSources } from '../utils/crypto';
import { policyDisplayName } from '../utils/policy';

/**
 * Create the binding message to be signed
 */
function createBindingMessage(
  policy: PolicyDefinition,
  fundingSources: FundingSource[],
  timestamp: number,
): string {
  const fundingSourcesHash = hashFundingSources(fundingSources);
  
  return [
    'zkpf Proof of Funds Binding',
    '',
    `Policy: ${policyDisplayName(policy)} (#${policy.policy_id})`,
    `Threshold: ${policy.threshold_raw}`,
    `Scope: ${policy.verifier_scope_id}`,
    `Sources Hash: ${fundingSourcesHash}`,
    `Timestamp: ${timestamp}`,
    '',
    'By signing this message, I bind this proof of funds attestation to my MetaMask identity.',
    'This does NOT grant any spending authority.',
  ].join('\n');
}

/**
 * Bind the holder identity by signing a message
 * Returns a holder_tag = keccak256(signature) for verifier identification.
 *
 * An optional timestamp can be provided so that the binding timestamp matches
 * the outer proof timestamp (e.g. in createProof). When omitted, the current
 * time is used.
 */
export async function bindHolder(
  policy: PolicyDefinition,
  fundingSources: FundingSource[],
  origin: string,
  timestampOverride?: number,
): Promise<HolderBinding> {
  // Get the signer address
  const accounts = await ethereum.request({
    method: 'eth_requestAccounts',
  }) as string[];
  
  if (!accounts || accounts.length === 0) {
    throw new Error('No Ethereum accounts connected');
  }
  
  const signerAddress = accounts[0];
  const timestamp = timestampOverride ?? Math.floor(Date.now() / 1000);
  
  // Create the message to sign
  const message = createBindingMessage(policy, fundingSources, timestamp);
  
  // Show confirmation dialog
  const confirmed = await confirmHolderBindingDialog(
    signerAddress,
    policyDisplayName(policy),
    message,
  );
  
  if (!confirmed) {
    throw new Error('User rejected holder binding');
  }
  
  // Request signature via personal_sign
  const signature = await ethereum.request({
    method: 'personal_sign',
    params: [message, signerAddress],
  }) as string;
  
  if (!signature) {
    throw new Error('Failed to obtain signature');
  }
  
  // Compute holder_tag = keccak256(signature)
  // This allows verifiers to see "this bundle was bound to the same MetaMask identity"
  // without learning the actual address
  const holderTag = computeHolderTag(signature);
  
  return {
    signature,
    holderTag,
    signerAddress,
    message,
  };
}

/**
 * Create typed data for EIP-712 signing (alternative to personal_sign)
 */
export function createTypedDataBinding(
  policy: PolicyDefinition,
  fundingSources: FundingSource[],
  timestamp: number,
) {
  const fundingSourcesHash = hashFundingSources(fundingSources);
  
  return {
    types: {
      EIP712Domain: [
        { name: 'name', type: 'string' },
        { name: 'version', type: 'string' },
        { name: 'chainId', type: 'uint256' },
      ],
      ProofOfFundsBinding: [
        { name: 'policyId', type: 'uint256' },
        { name: 'threshold', type: 'uint256' },
        { name: 'scopeId', type: 'uint256' },
        { name: 'fundingSourcesHash', type: 'string' },
        { name: 'timestamp', type: 'uint256' },
      ],
    },
    primaryType: 'ProofOfFundsBinding',
    domain: {
      name: 'zkpf Proof of Funds',
      version: '1',
      chainId: 1,
    },
    message: {
      policyId: policy.policy_id,
      threshold: policy.threshold_raw,
      scopeId: policy.verifier_scope_id,
      fundingSourcesHash,
      timestamp,
    },
  };
}

/**
 * Bind holder using EIP-712 typed data signing.
 *
 * Accepts an optional timestamp override for consistency with createProof.
 */
export async function bindHolderTypedData(
  policy: PolicyDefinition,
  fundingSources: FundingSource[],
  _origin: string,
  timestampOverride?: number,
): Promise<HolderBinding> {
  // Get the signer address
  const accounts = await ethereum.request({
    method: 'eth_requestAccounts',
  }) as string[];
  
  if (!accounts || accounts.length === 0) {
    throw new Error('No Ethereum accounts connected');
  }
  
  const signerAddress = accounts[0];
  const timestamp = timestampOverride ?? Math.floor(Date.now() / 1000);
  
  // Create typed data
  const typedData = createTypedDataBinding(policy, fundingSources, timestamp);
  
  // Show confirmation dialog with readable message
  const readableMessage = [
    'zkpf Proof of Funds Binding (EIP-712)',
    '',
    `Policy ID: ${policy.policy_id}`,
    `Threshold: ${policy.threshold_raw}`,
    `Scope: ${policy.verifier_scope_id}`,
    `Timestamp: ${timestamp}`,
  ].join('\n');
  
  const confirmed = await confirmHolderBindingDialog(
    signerAddress,
    policyDisplayName(policy),
    readableMessage,
  );
  
  if (!confirmed) {
    throw new Error('User rejected holder binding');
  }
  
  // Request signature via eth_signTypedData_v4
  const signature = await ethereum.request({
    method: 'eth_signTypedData_v4',
    params: [signerAddress, JSON.stringify(typedData)],
  }) as string;
  
  if (!signature) {
    throw new Error('Failed to obtain signature');
  }
  
  // Compute holder_tag
  const holderTag = computeHolderTag(signature);
  
  return {
    signature,
    holderTag,
    signerAddress,
    message: JSON.stringify(typedData),
  };
}

