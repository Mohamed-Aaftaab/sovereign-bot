import { ethers } from 'ethers';

const RPC = 'http://5.161.35.78:8545';
const provider = new ethers.JsonRpcProvider(RPC, 42069, { staticNetwork: true });
const EOA = '0xfB9C1BCAD029dB8Ef4fA9565760888926De65068';

async function main() {
  console.log("Measuring custom RPC latencies...");
  
  const start = Date.now();
  
  const blockStart = Date.now();
  const block = await provider.getBlockNumber();
  console.log(`- eth_blockNumber: ${Date.now() - blockStart}ms (Block: ${block})`);
  
  const nonceStart = Date.now();
  const nonce = await provider.getTransactionCount(EOA);
  console.log(`- eth_getTransactionCount: ${Date.now() - nonceStart}ms (Nonce: ${nonce})`);
  
  const gasStart = Date.now();
  const feeData = await provider.getFeeData();
  console.log(`- eth_gasPrice/feeData: ${Date.now() - gasStart}ms`);
  
  console.log(`Total time for 3 RPC requests: ${Date.now() - start}ms`);
}

main().catch(console.error);
