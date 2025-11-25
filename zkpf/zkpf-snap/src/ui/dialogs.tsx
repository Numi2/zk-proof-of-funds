import {
  Box,
  Heading,
  Text,
  Divider,
  Copyable,
  Bold,
  Row,
  Address,
} from '@metamask/snaps-sdk/jsx';
import type { PolicyDefinition, FundingSource } from '../types';
import { policyDisplayName, formatPolicyThreshold, policyCategoryLabel } from '../utils/policy';

/**
 * Installation welcome dialog
 */
export const installDialog = async () => {
  await snap.request({
    method: 'snap_dialog',
    params: {
      type: 'alert',
      content: (
        <Box>
          <Heading>Welcome to zkpf Proof of Funds</Heading>
          <Text>
            This snap enables you to create zero-knowledge proofs of your assets
            without revealing sensitive balance information.
          </Text>
          <Divider />
          <Text>
            You can prove you meet a threshold (e.g., ≥10,000 USD) without
            disclosing your exact balance or account details.
          </Text>
        </Box>
      ),
    },
  });
};

/**
 * Policy selection confirmation dialog
 */
export const confirmPolicyDialog = async (
  policy: PolicyDefinition,
): Promise<boolean> => {
  const result = await snap.request({
    method: 'snap_dialog',
    params: {
      type: 'confirmation',
      content: (
        <Box>
          <Heading>Confirm Policy Selection</Heading>
          <Divider />
          <Row label="Policy">
            <Text>{policyDisplayName(policy)}</Text>
          </Row>
          <Row label="Threshold">
            <Text>{formatPolicyThreshold(policy)}</Text>
          </Row>
          <Row label="Category">
            <Text>{policyCategoryLabel(policy)}</Text>
          </Row>
          <Row label="Scope ID">
            <Text>{String(policy.verifier_scope_id)}</Text>
          </Row>
          <Divider />
          <Text>
            You will prove that your total assets meet or exceed this threshold.
          </Text>
        </Box>
      ),
    },
  });
  return result === true;
};

/**
 * Format a funding source for display
 */
function formatFundingSource(source: FundingSource, index: number): string {
  if (source.type === 'ethereum') {
    const addr = source.address;
    return `${index + 1}. Ethereum: ${addr.slice(0, 6)}...${addr.slice(-4)}${source.chainId ? ` (Chain ${source.chainId})` : ''}`;
  } else {
    const ufvkShort = `${source.ufvk.slice(0, 15)}...${source.ufvk.slice(-8)}`;
    return `${index + 1}. Zcash (${source.network}): ${ufvkShort}${source.snapshotHeight ? ` @ height ${source.snapshotHeight}` : ''}`;
  }
}

/**
 * Funding sources review dialog
 */
export const reviewFundingSourcesDialog = async (
  sources: FundingSource[],
): Promise<boolean> => {
  const sourceDescriptions = sources.map((source, index) => formatFundingSource(source, index));
  
  const result = await snap.request({
    method: 'snap_dialog',
    params: {
      type: 'confirmation',
      content: (
        <Box>
          <Heading>Review Funding Sources</Heading>
          <Text>
            The following funding sources will be used for your proof of funds:
          </Text>
          <Divider />
          {sourceDescriptions.map((desc) => (
            <Text>{desc}</Text>
          ))}
          <Divider />
          <Text>
            <Bold>Note:</Bold> Your exact balances will NOT be revealed.
            Only that you meet the threshold.
          </Text>
        </Box>
      ),
    },
  });
  return result === true;
};

/**
 * Holder binding signature confirmation dialog
 */
export const confirmHolderBindingDialog = async (
  signerAddress: string,
  policyName: string,
  message: string,
): Promise<boolean> => {
  const result = await snap.request({
    method: 'snap_dialog',
    params: {
      type: 'confirmation',
      content: (
        <Box>
          <Heading>Bind Your Identity</Heading>
          <Text>
            Sign a message to bind this proof to your MetaMask identity.
          </Text>
          <Divider />
          <Row label="Signer">
            <Address address={signerAddress as `0x${string}`} />
          </Row>
          <Row label="Policy">
            <Text>{policyName}</Text>
          </Row>
          <Divider />
          <Text>Message to sign:</Text>
          <Copyable value={message} />
          <Divider />
          <Text>
            This creates a unique <Bold>holder_tag</Bold> that lets verifiers
            confirm this proof was bound to the same MetaMask identity without
            learning your actual address.
          </Text>
        </Box>
      ),
    },
  });
  return result === true;
};

/**
 * Proof generation success dialog
 */
export const proofSuccessDialog = async (
  holderTag: string,
  policyName: string,
): Promise<void> => {
  await snap.request({
    method: 'snap_dialog',
    params: {
      type: 'alert',
      content: (
        <Box>
          <Heading>Proof Created Successfully</Heading>
          <Text>
            Your zero-knowledge proof of funds has been generated and bound to
            your identity.
          </Text>
          <Divider />
          <Row label="Policy">
            <Text>{policyName}</Text>
          </Row>
          <Text>Holder Tag:</Text>
          <Copyable value={holderTag} />
          <Divider />
          <Text>
            Share your proof bundle with verifiers. They can confirm you meet
            the threshold without seeing your actual balance.
          </Text>
        </Box>
      ),
    },
  });
};

/**
 * Error dialog
 */
export const errorDialog = async (
  title: string,
  message: string,
): Promise<void> => {
  await snap.request({
    method: 'snap_dialog',
    params: {
      type: 'alert',
      content: (
        <Box>
          <Heading>{title}</Heading>
          <Divider />
          <Text>{message}</Text>
        </Box>
      ),
    },
  });
};

/**
 * Zcash UFVK input dialog
 */
export const inputUfvkDialog = async (): Promise<string | null> => {
  const result = await snap.request({
    method: 'snap_dialog',
    params: {
      type: 'prompt',
      content: (
        <Box>
          <Heading>Enter Zcash UFVK</Heading>
          <Text>
            Paste your Unified Full Viewing Key (UFVK) from your Zcash wallet
            (Zashi, YWallet, Zingo, etc.).
          </Text>
          <Divider />
          <Text>
            The UFVK allows view-only access to your shielded balance without
            spending authority.
          </Text>
        </Box>
      ),
      placeholder: 'uview1...',
    },
  });
  
  if (typeof result === 'string' && result.trim()) {
    return result.trim();
  }
  return null;
};

/**
 * Zcash snapshot height input dialog
 */
export const inputSnapshotHeightDialog = async (): Promise<number | null> => {
  const result = await snap.request({
    method: 'snap_dialog',
    params: {
      type: 'prompt',
      content: (
        <Box>
          <Heading>Enter Snapshot Height</Heading>
          <Text>
            Enter the Zcash block height at which your balance snapshot was taken.
          </Text>
          <Divider />
          <Text>
            You can find this in your Zcash wallet or use a block explorer.
          </Text>
        </Box>
      ),
      placeholder: 'e.g. 2700000',
    },
  });
  
  if (typeof result === 'string' && result.trim()) {
    const height = parseInt(result.trim(), 10);
    if (!isNaN(height) && height > 0) {
      return height;
    }
  }
  return null;
};

/**
 * Zcash balance input dialog
 */
export const inputBalanceZatsDialog = async (): Promise<number | null> => {
  const result = await snap.request({
    method: 'snap_dialog',
    params: {
      type: 'prompt',
      content: (
        <Box>
          <Heading>Enter Shielded Balance</Heading>
          <Text>
            Enter your shielded balance in zatoshis (1 ZEC = 100,000,000 zats).
          </Text>
          <Divider />
          <Text>
            Example: 10 ZEC = 1000000000 zats
          </Text>
        </Box>
      ),
      placeholder: 'e.g. 1000000000 for 10 ZEC',
    },
  });
  
  if (typeof result === 'string' && result.trim()) {
    const balance = parseInt(result.trim().replace(/[,_\s]/g, ''), 10);
    if (!isNaN(balance) && balance > 0) {
      return balance;
    }
  }
  return null;
};
