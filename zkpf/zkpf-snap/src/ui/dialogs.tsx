import {
  Box,
  Heading,
  Text,
  Divider,
  Copyable,
  Bold,
  Row,
  Address,
  Icon,
} from '@metamask/snaps-sdk/jsx';
import type { PolicyDefinition, FundingSource, ProofHistoryEntry, NetworkType } from '../types';
import { policyDisplayName, formatPolicyThreshold, policyCategoryLabel } from '../utils/policy';
import type { VerificationResult } from '../rpc/verifyBundle';

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

/**
 * Export bundle dialog - shows the bundle JSON for copying
 */
export const exportBundleDialog = async (
  bundleJson: string,
  bundleId: string,
): Promise<void> => {
  await snap.request({
    method: 'snap_dialog',
    params: {
      type: 'alert',
      content: (
        <Box>
          <Heading>Proof Bundle Ready</Heading>
          <Text>
            Your proof bundle has been created. Copy the JSON below to share
            with verifiers.
          </Text>
          <Divider />
          <Row label="Bundle ID">
            <Text>{bundleId}</Text>
          </Row>
          <Divider />
          <Text>Bundle JSON:</Text>
          <Copyable value={bundleJson} />
          <Divider />
          <Text>
            <Bold>Important:</Bold> Share this bundle with the verifier.
            They can confirm you meet the threshold without seeing your actual balance.
          </Text>
        </Box>
      ),
    },
  });
};

/**
 * Verify bundle input dialog - prompt for bundle JSON
 */
export const verifyBundleDialog = async (): Promise<string | null> => {
  const result = await snap.request({
    method: 'snap_dialog',
    params: {
      type: 'prompt',
      content: (
        <Box>
          <Heading>Verify Proof Bundle</Heading>
          <Text>
            Paste a proof bundle JSON to verify its integrity and contents.
          </Text>
          <Divider />
          <Text>
            The verification will check the bundle format, holder signature,
            and other validity criteria.
          </Text>
        </Box>
      ),
      placeholder: '{"version": "1.0.0", "proofRequest": {...}}',
    },
  });
  
  if (typeof result === 'string' && result.trim()) {
    return result.trim();
  }
  return null;
};

/**
 * Verification result dialog
 */
export const verifyResultDialog = async (
  result: VerificationResult,
): Promise<void> => {
  const statusIcon = result.valid ? '✓' : '✗';
  const statusText = result.valid ? 'Valid' : 'Invalid';
  
  const checksList = [
    `Bundle Format: ${result.checks.bundleFormat ? '✓' : '✗'}`,
    `Holder Tag: ${result.checks.holderTagValid ? '✓' : '✗'}`,
    `Signature: ${result.checks.signaturePresent ? '✓' : '✗'}`,
    `Policy: ${result.checks.policyPresent ? '✓' : '✗'}`,
    `Sources: ${result.checks.fundingSourcesPresent ? '✓' : '✗'}`,
    `Timestamp: ${result.checks.timestampValid ? '✓' : '✗'}`,
  ].join('\n');
  
  await snap.request({
    method: 'snap_dialog',
    params: {
      type: 'alert',
      content: (
        <Box>
          <Heading>Verification Result: {statusIcon} {statusText}</Heading>
          <Divider />
          <Row label="Bundle ID">
            <Text>{result.bundleId}</Text>
          </Row>
          <Row label="Policy">
            <Text>{result.details.policyName}</Text>
          </Row>
          <Row label="Threshold">
            <Text>{result.details.threshold}</Text>
          </Row>
          <Row label="Created">
            <Text>{result.details.timestamp}</Text>
          </Row>
          <Row label="Funding Sources">
            <Text>{String(result.details.fundingSourceCount)}</Text>
          </Row>
          <Divider />
          <Text><Bold>Checks:</Bold></Text>
          <Text>{checksList}</Text>
          {result.errors.length > 0 && (
            <Box>
              <Divider />
              <Text><Bold>Errors:</Bold></Text>
              {result.errors.map((err) => <Text>• {err}</Text>)}
            </Box>
          )}
        </Box>
      ),
    },
  });
};

/**
 * Proof history dialog
 */
export const proofHistoryDialog = async (
  history: ProofHistoryEntry[],
): Promise<void> => {
  if (history.length === 0) {
    await snap.request({
      method: 'snap_dialog',
      params: {
        type: 'alert',
        content: (
          <Box>
            <Heading>Proof History</Heading>
            <Divider />
            <Text>No proofs have been created yet.</Text>
            <Text>
              Create your first proof of funds to see it here.
            </Text>
          </Box>
        ),
      },
    });
    return;
  }
  
  const historyEntries = history.slice(0, 10).map((entry, index) => {
    const date = new Date(entry.timestamp * 1000).toLocaleDateString();
    const verifiedIcon = entry.verified ? ' ✓' : '';
    return `${index + 1}. ${entry.policyLabel} (${date})${verifiedIcon}`;
  });
  
  await snap.request({
    method: 'snap_dialog',
    params: {
      type: 'alert',
      content: (
        <Box>
          <Heading>Proof History</Heading>
          <Text>Recent proofs (showing up to 10):</Text>
          <Divider />
          {historyEntries.map((entry) => <Text>{entry}</Text>)}
          <Divider />
          <Text>Total proofs: {String(history.length)}</Text>
        </Box>
      ),
    },
  });
};

/**
 * Confirm clear history dialog
 */
export const confirmClearHistoryDialog = async (): Promise<boolean> => {
  const result = await snap.request({
    method: 'snap_dialog',
    params: {
      type: 'confirmation',
      content: (
        <Box>
          <Heading>Clear Proof History?</Heading>
          <Divider />
          <Text>
            This will permanently delete all proof history from this snap.
          </Text>
          <Text>
            <Bold>This action cannot be undone.</Bold>
          </Text>
        </Box>
      ),
    },
  });
  return result === true;
};

/**
 * Network switch confirmation dialog
 */
export const confirmNetworkSwitchDialog = async (
  network: NetworkType,
): Promise<boolean> => {
  const networkName = network === 'mainnet' ? 'Mainnet' : 'Testnet';
  
  const result = await snap.request({
    method: 'snap_dialog',
    params: {
      type: 'confirmation',
      content: (
        <Box>
          <Heading>Switch to {networkName}?</Heading>
          <Divider />
          <Text>
            This will switch both Ethereum and Zcash networks to {networkName}.
          </Text>
          {network === 'testnet' && (
            <Text>
              <Bold>Note:</Bold> Testnet is for development purposes only.
              Proofs created on testnet have no real value.
            </Text>
          )}
        </Box>
      ),
    },
  });
  return result === true;
};

/**
 * Show holder fingerprint dialog
 */
export const showFingerprintDialog = async (
  fingerprint: string,
): Promise<void> => {
  const shortFingerprint = `${fingerprint.slice(0, 10)}...${fingerprint.slice(-8)}`;
  
  await snap.request({
    method: 'snap_dialog',
    params: {
      type: 'alert',
      content: (
        <Box>
          <Heading>Your Holder Fingerprint</Heading>
          <Text>
            This unique fingerprint identifies you across proofs without
            revealing your actual wallet address.
          </Text>
          <Divider />
          <Row label="Short">
            <Text>{shortFingerprint}</Text>
          </Row>
          <Text>Full Fingerprint:</Text>
          <Copyable value={fingerprint} />
          <Divider />
          <Text>
            Verifiers can use this to correlate multiple proofs from you
            without learning your MetaMask address.
          </Text>
        </Box>
      ),
    },
  });
};
