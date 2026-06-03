import { ethers } from 'ethers';

const RPC = 'http://5.161.35.78:8545';
const provider = new ethers.JsonRpcProvider(RPC, 42069, { staticNetwork: true });

const pk = '0xe29653ddb6ba4ac0af133a11216bd1972d5b50879eed816b9be2d083978c40b8';
const wallet = new ethers.Wallet(pk, provider);
const EOA = wallet.address;

async function testSign(txRequest, label) {
  try {
    const signed = await wallet.signTransaction(txRequest);
    console.log(`[${label}] Success! Signed length: ${signed.length}`);
  } catch (e) {
    console.log(`[${label}] Failed: ${e.message}`);
  }
}

async function main() {
  const nonce = await provider.getTransactionCount(EOA);
  
  console.log("Testing legacy gasPrice override...");
  await testSign({
    to: EOA,
    value: 0n,
    gasLimit: 21000n,
    gasPrice: ethers.parseUnits('3500.0', 'gwei'),
    nonce: nonce,
    chainId: 42069
  }, "LEGACY GAS PRICE");

  console.log("\nTesting EIP-1559 fee overrides...");
  await testSign({
    to: EOA,
    value: 0n,
    gasLimit: 21000n,
    maxPriorityFeePerGas: ethers.parseUnits('3000.0', 'gwei'),
    maxFeePerGas: ethers.parseUnits('3500.0', 'gwei'),
    nonce: nonce,
    chainId: 42069
  }, "EIP-1559 FEES");
}

main().catch(console.error);
