/**
 * Setup script for ZKPF Mina Contracts
 *
 * This script:
 * 1. Generates a new Mina keypair (if needed)
 * 2. Saves keys securely
 * 3. Provides faucet instructions
 */

import { PrivateKey } from 'o1js';
import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';

// ES Module compatibility
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// ═══════════════════════════════════════════════════════════════════════════════
// KEY MANAGEMENT
// ═══════════════════════════════════════════════════════════════════════════════

const KEYS_DIR = path.join(__dirname, '..', 'keys');
const KEYS_FILE = path.join(KEYS_DIR, 'deployer.json');

interface KeyPair {
  publicKey: string;
  privateKey: string;
  createdAt: string;
}

function ensureKeysDir() {
  if (!fs.existsSync(KEYS_DIR)) {
    fs.mkdirSync(KEYS_DIR, { recursive: true });
  }

  // Add .gitignore to keys directory
  const gitignorePath = path.join(KEYS_DIR, '.gitignore');
  if (!fs.existsSync(gitignorePath)) {
    fs.writeFileSync(gitignorePath, '*\n!.gitignore\n');
  }
}

function generateNewKeypair(): KeyPair {
  const privateKey = PrivateKey.random();
  const publicKey = privateKey.toPublicKey();

  return {
    publicKey: publicKey.toBase58(),
    privateKey: privateKey.toBase58(),
    createdAt: new Date().toISOString(),
  };
}

function saveKeypair(keypair: KeyPair) {
  ensureKeysDir();
  fs.writeFileSync(KEYS_FILE, JSON.stringify(keypair, null, 2), { mode: 0o600 });
  console.log(`\n✅ Keys saved to: ${KEYS_FILE}`);
}

function loadKeypair(): KeyPair | null {
  if (!fs.existsSync(KEYS_FILE)) {
    return null;
  }
  return JSON.parse(fs.readFileSync(KEYS_FILE, 'utf8'));
}

// ═══════════════════════════════════════════════════════════════════════════════
// OUTPUT FUNCTIONS
// ═══════════════════════════════════════════════════════════════════════════════

function printTestnetInstructions(keypair: KeyPair) {
  console.log('\n' + '═'.repeat(70));
  console.log('                    MINA TESTNET SETUP');
  console.log('═'.repeat(70));

  console.log('\n📋 Your Mina Address:');
  console.log(`   ${keypair.publicKey}`);

  console.log('\n🚰 Get Testnet MINA:');
  console.log('   1. Go to: https://faucet.minaprotocol.com/');
  console.log('   2. Select "Berkeley Testnet" from the dropdown');
  console.log('   3. Paste your address above');
  console.log('   4. Complete the captcha and request tokens');
  console.log('   5. Wait ~2 minutes for tokens to arrive');

  console.log('\n🔐 Your Private Key (KEEP SECRET!):');
  console.log(`   ${keypair.privateKey}`);

  console.log('\n📝 To deploy after receiving tokens:');
  console.log(`   MINA_PRIVATE_KEY="${keypair.privateKey}" npm run deploy`);

  console.log('\n' + '═'.repeat(70));
}

// ═══════════════════════════════════════════════════════════════════════════════
// MAIN
// ═══════════════════════════════════════════════════════════════════════════════

async function main() {
  const args = process.argv.slice(2);
  const command = args[0] || 'keys';

  console.log('═'.repeat(70));
  console.log('              ZKPF MINA CONTRACTS SETUP');
  console.log('═'.repeat(70));

  switch (command) {
    case 'keys':
    case 'generate': {
      // Check for existing keys
      const existing = loadKeypair();
      if (existing) {
        console.log('\n⚠️  Existing keypair found!');
        console.log(`   Address: ${existing.publicKey}`);
        console.log(`   Created: ${existing.createdAt}`);
        console.log('\nUsing existing keys (delete keys/deployer.json to regenerate).');
        printTestnetInstructions(existing);
        return;
      }

      console.log('\n🔑 Generating new Mina keypair...');
      const keypair = generateNewKeypair();
      saveKeypair(keypair);
      printTestnetInstructions(keypair);
      break;
    }

    case 'testnet': {
      const keypair = loadKeypair();
      if (!keypair) {
        console.log('\n❌ No keypair found. Run `npm run setup` first.');
        process.exit(1);
      }
      printTestnetInstructions(keypair);
      break;
    }

    case 'show': {
      const keypair = loadKeypair();
      if (!keypair) {
        console.log('\n❌ No keypair found. Run `npm run setup` first.');
        process.exit(1);
      }
      console.log('\n📋 Your Mina Address:');
      console.log(`   ${keypair.publicKey}`);
      console.log('\n🔐 Your Private Key:');
      console.log(`   ${keypair.privateKey}`);
      break;
    }

    case 'help':
    default: {
      console.log('\nUsage: npm run setup [command]\n');
      console.log('Commands:');
      console.log('  keys      Generate new Mina keypair (default)');
      console.log('  testnet   Show testnet deployment instructions');
      console.log('  show      Show saved keypair');
      console.log('  help      Show this help message');
      console.log('\nExamples:');
      console.log('  npm run setup              # Generate keys');
      console.log('  npm run setup testnet      # Testnet instructions');
    }
  }
}

main().catch((e) => {
  console.error('\n❌ Setup failed:', e);
  process.exit(1);
});
