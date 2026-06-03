import { ethers } from 'ethers';

const RPC = 'http://5.161.35.78:8545';
const provider = new ethers.JsonRpcProvider(RPC, 42069, { staticNetwork: true });

const pk = '0xe29653ddb6ba4ac0af133a11216bd1972d5b50879eed816b9be2d083978c40b8';
const wallet = new ethers.Wallet(pk, provider);
const EOA = wallet.address;

async function main() {
  const nonce = await provider.getTransactionCount(EOA);
  
  const txRequest = {
    to: EOA,
    value: ethers.parseEther('0.0001'),
    gasLimit: 21000n,
    nonce: nonce,
    chainId: 42069,
    gasPrice: ethers.parseUnits('3500.0', 'gwei')
  };

  try {
    console.log("Signing transaction...");
    const signed = await wallet.signTransaction(txRequest);
    console.log("Broadcasting transaction...");
    const tx = await provider.broadcastTransaction(signed);
    console.log("Tx sent! Hash:", tx.hash);
    console.log("Waiting for mining...");
    const rec = await tx.wait();
    console.log("Mined in block:", rec.blockNumber);
  } catch (e) {
    console.error("Broadcast failed:", e);
  }
}

main().catch(console.error);
