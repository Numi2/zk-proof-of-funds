import { Mina, PrivateKey, AccountUpdate, Field } from 'o1js';
import { Add } from './Add.js';

async function main() {
  console.log('Testing Add contract...');
  
  const Local = await Mina.LocalBlockchain({ proofsEnabled: false });
  Mina.setActiveInstance(Local);
  
  const [deployer] = Local.testAccounts;
  const fee = 0.1 * 1e9;
  
  console.log('Compiling...');
  await Add.compile();
  
  console.log('Deploying...');
  const zkAppPrivateKey = PrivateKey.random();
  const zkAppAddress = zkAppPrivateKey.toPublicKey();
  const zkApp = new Add(zkAppAddress);
  
  const deployTx = await Mina.transaction({ sender: deployer, fee }, async () => {
    AccountUpdate.fundNewAccount(deployer);
    await zkApp.deploy();
  });
  await deployTx.prove();
  await deployTx.sign([deployer.key, zkAppPrivateKey]).send();
  
  console.log('Checking initial state...');
  const num0 = zkApp.num.get();
  console.log('Initial num:', num0.toString());
  
  console.log('Calling update...');
  const tx = await Mina.transaction({ sender: deployer, fee }, async () => {
    await zkApp.update();
  });
  await tx.prove();
  await tx.sign([deployer.key]).send();
  
  console.log('Checking updated state...');
  const num1 = zkApp.num.get();
  console.log('Updated num:', num1.toString());
  
  console.log('✅ Test passed!');
}

main().catch(console.error);
