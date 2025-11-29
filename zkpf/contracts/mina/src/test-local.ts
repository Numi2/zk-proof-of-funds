/**
 * Test ZKPF Mina zkApps locally without requiring testnet funds
 */

import { Mina, PrivateKey, AccountUpdate, Field, UInt64 } from 'o1js';
import { ZkpfVerifierSimple } from './ZkpfVerifierSimple.js';

async function main() {
  console.log('═'.repeat(70));
  console.log('          ZKPF MINA CONTRACTS LOCAL TEST');
  console.log('═'.repeat(70));

  // Set up local blockchain
  console.log('\n🔧 Setting up local blockchain...');
  const Local = await Mina.LocalBlockchain({ proofsEnabled: false });
  Mina.setActiveInstance(Local);

  // Get test accounts
  const [deployer] = Local.testAccounts;
  console.log(`   Deployer: ${deployer.toBase58().slice(0, 20)}...`);

  const fee = 0.1 * 1e9;

  // Compile ZkpfVerifierSimple
  console.log('\n📦 Compiling ZkpfVerifierSimple...');
  console.time('   Compile time');
  await ZkpfVerifierSimple.compile();
  console.timeEnd('   Compile time');

  // Deploy
  console.log('\n🚀 Deploying ZkpfVerifierSimple...');
  const zkpfVerifierKey = PrivateKey.random();
  const zkpfVerifierAddress = zkpfVerifierKey.toPublicKey();
  const zkpfVerifier = new ZkpfVerifierSimple(zkpfVerifierAddress);

  const deployTx = await Mina.transaction({ sender: deployer, fee }, async () => {
    AccountUpdate.fundNewAccount(deployer);
    await zkpfVerifier.deploy();
  });
  await deployTx.prove();
  await deployTx.sign([deployer.key, zkpfVerifierKey]).send();
  console.log(`   ✅ Deployed at: ${zkpfVerifierAddress.toBase58().slice(0, 30)}...`);

  // Verify initial state
  console.log('\n🔍 Verifying initial state...');
  const initialCount = zkpfVerifier.attestationCount.get();
  console.log(`   Attestation count: ${initialCount.toString()}`);

  // Create an attestation
  console.log('\n📝 Creating test attestation...');
  const testHolderBinding = Field(12345);
  const testPolicyId = UInt64.from(1);
  const testEpoch = UInt64.from(100);

  const attestTx = await Mina.transaction({ sender: deployer, fee }, async () => {
    await zkpfVerifier.createAttestation(testHolderBinding, testPolicyId, testEpoch);
  });
  await attestTx.prove();
  await attestTx.sign([deployer.key]).send();
  console.log('   ✅ Attestation created!');

  // Verify updated state
  console.log('\n🔍 Verifying updated state...');
  const updatedCount = zkpfVerifier.attestationCount.get();
  console.log(`   Attestation count: ${updatedCount.toString()}`);

  console.log('\n' + '═'.repeat(70));
  console.log('          ✅ LOCAL TEST COMPLETED SUCCESSFULLY');
  console.log('═'.repeat(70));
  console.log(`\nContract Address: ${zkpfVerifierAddress.toBase58()}`);
  console.log('\n');
}

main().catch((e) => {
  console.error('\n❌ Test failed:', e);
  process.exit(1);
});
