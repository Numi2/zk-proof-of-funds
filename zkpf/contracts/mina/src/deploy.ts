/**
 * Deploy ZKPF Mina zkApps to Devnet
 */

import {
  Mina,
  PrivateKey,
  PublicKey,
  AccountUpdate,
  fetchAccount,
} from 'o1js';
import { ZkpfVerifierSimple } from './ZkpfVerifierSimple.js';
import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Network configurations
const NETWORKS: Record<string, { name: string; mina: string; explorerUrl: string; local?: boolean }> = {
  local: {
    name: 'Local Network',
    mina: 'http://localhost:8080/graphql',
    explorerUrl: 'http://localhost:8181',
    local: true,
  },
  devnet: {
    name: 'Devnet',
    mina: 'https://api.minascan.io/node/devnet/v1/graphql',
    explorerUrl: 'https://minascan.io/devnet',
  },
};

interface DeploymentResult {
  contractName: string;
  address: string;
  txHash: string;
}

// Load keys
function loadKeys(): { publicKey: string; privateKey: string } | null {
  const keysFile = path.join(__dirname, '..', 'keys', 'deployer.json');
  if (!fs.existsSync(keysFile)) {
    return null;
  }
  return JSON.parse(fs.readFileSync(keysFile, 'utf8'));
}

// Save deployment info
function saveDeployment(contractName: string, info: Record<string, unknown>, network: string) {
  const deploymentsDir = path.join(__dirname, '..', 'deployments', network);
  if (!fs.existsSync(deploymentsDir)) {
    fs.mkdirSync(deploymentsDir, { recursive: true });
  }
  fs.writeFileSync(
    path.join(deploymentsDir, `${contractName}.json`),
    JSON.stringify(info, null, 2)
  );
}

async function main() {
  console.log('═'.repeat(70));
  console.log('              ZKPF MINA CONTRACTS DEPLOYMENT');
  console.log('═'.repeat(70));

  // Get private key from env or keys file
  let privateKeyBase58 = process.env.MINA_PRIVATE_KEY;
  if (!privateKeyBase58) {
    const keys = loadKeys();
    if (keys) {
      privateKeyBase58 = keys.privateKey;
      console.log(`\n📋 Using saved keypair: ${keys.publicKey.slice(0, 20)}...`);
    }
  }

  if (!privateKeyBase58) {
    console.error('\n❌ No private key found!');
    console.log('   Run `npm run setup` first to generate keys.');
    process.exit(1);
  }

  const networkName = (process.env.MINA_NETWORK || 'devnet').toLowerCase();
  const network = NETWORKS[networkName];
  if (!network) {
    console.error(`\n❌ Unknown network: ${networkName}`);
    process.exit(1);
  }

  console.log(`\nNetwork: ${network.name}`);

  // Initialize deployer
  const deployerKey = PrivateKey.fromBase58(privateKeyBase58);
  const deployerAddress = deployerKey.toPublicKey();
  console.log(`Deployer: ${deployerAddress.toBase58()}`);

  // Connect to network
  console.log(`\nConnecting to ${network.name}...`);
  const Network = Mina.Network(network.mina);
  Mina.setActiveInstance(Network);

  // Check balance (skip for local network)
  console.log('Checking balance...');
  
  if (network.local) {
    console.log('Using local network - accounts are pre-funded');
  } else {
    try {
      const account = await fetchAccount({ publicKey: deployerAddress });
      if (!account.account) {
        console.error('\n❌ Account not found on chain!');
        console.log('   Get testnet MINA from: https://faucet.minaprotocol.com/');
        console.log(`   Your address: ${deployerAddress.toBase58()}`);
        process.exit(1);
      }
      const balance = Number(account.account.balance.toBigInt()) / 1e9;
      console.log(`Balance: ${balance.toFixed(4)} MINA`);

      if (balance < 3) {
        console.error('\n❌ Insufficient balance! Need at least 3 MINA.');
        console.log('   Get testnet MINA from: https://faucet.minaprotocol.com/');
        process.exit(1);
      }
    } catch (e) {
      console.error('\n❌ Failed to fetch account:', e);
      console.log('   Get testnet MINA from: https://faucet.minaprotocol.com/');
      console.log(`   Your address: ${deployerAddress.toBase58()}`);
      process.exit(1);
    }
  }

  const results: DeploymentResult[] = [];
  const fee = 0.1 * 1e9; // 0.1 MINA

  // Compile and deploy ZkpfVerifierSimple
  console.log('\n📦 Compiling ZkpfVerifierSimple...');
  const { verificationKey: vk1 } = await ZkpfVerifierSimple.compile();
  console.log(`   VK hash: ${vk1.hash.toString().slice(0, 20)}...`);

  const zkpfVerifierKey = PrivateKey.random();
  const zkpfVerifierAddress = zkpfVerifierKey.toPublicKey();
  console.log(`   Address: ${zkpfVerifierAddress.toBase58()}`);

  console.log('   Deploying...');
  const zkpfVerifier = new ZkpfVerifierSimple(zkpfVerifierAddress);
  const tx1 = await Mina.transaction(
    { sender: deployerAddress, fee },
    async () => {
      AccountUpdate.fundNewAccount(deployerAddress);
      await zkpfVerifier.deploy({ verificationKey: vk1 });
    }
  );
  await tx1.prove();
  const pending1 = await tx1.sign([deployerKey, zkpfVerifierKey]).send();
  console.log(`   TX: ${pending1.hash}`);
  console.log('   Waiting for confirmation...');
  await pending1.wait();
  console.log('   ✅ ZkpfVerifierSimple deployed!');

  results.push({
    contractName: 'ZkpfVerifierSimple',
    address: zkpfVerifierAddress.toBase58(),
    txHash: pending1.hash,
  });

  saveDeployment('ZkpfVerifierSimple', {
    address: zkpfVerifierAddress.toBase58(),
    privateKey: zkpfVerifierKey.toBase58(),
    vkHash: vk1.hash.toString(),
    txHash: pending1.hash,
    deployedAt: new Date().toISOString(),
    network: network.name,
  }, networkName);

  // Summary
  console.log('\n' + '═'.repeat(70));
  console.log('                    DEPLOYMENT SUMMARY');
  console.log('═'.repeat(70));

  for (const result of results) {
    console.log(`\n${result.contractName}:`);
    console.log(`   Address:  ${result.address}`);
    console.log(`   TX:       ${result.txHash}`);
    console.log(`   Explorer: ${network.explorerUrl}/account/${result.address}`);
  }

  console.log('\n✅ All contracts deployed successfully!');
  console.log(`   Deployments saved to: deployments/${networkName}/`);
  console.log('\n' + '═'.repeat(70));
}

main().catch((e) => {
  console.error('\n❌ Deployment failed:', e);
  process.exit(1);
});
