import { ethers } from 'ethers';

const RPC_OFFICIAL = 'http://alpha.creator.bid:8545';
const RPC_CUSTOM = 'http://5.161.35.78:8545';
const EOA = '0xfB9C1BCAD029dB8Ef4fA9565760888926De65068';

async function testRPC(url, name) {
  const provider = new ethers.JsonRpcProvider(url);
  const start = Date.now();
  
  // 1. Get block number
  const blockStart = Date.now();
  const block = await provider.getBlockNumber();
  const blockTime = Date.now() - blockStart;
  
  // 2. Get transaction count (nonce)
  const nonceStart = Date.now();
  const nonce = await provider.getTransactionCount(EOA);
  const nonceTime = Date.now() - nonceStart;
  
  const total = Date.now() - start;
  console.log(`[${name}] URL: ${url}`);
  console.log(`  eth_blockNumber: ${blockTime}ms (Block: ${block})`);
  console.log(`  eth_getTransactionCount: ${nonceTime}ms (Nonce: ${nonce})`);
  console.log(`  Total time: ${total}ms`);
  return { block, nonce };
}

async function main() {
  console.log("Comparing RPC latencies...");
  await testRPC(RPC_OFFICIAL, "OFFICIAL");
  console.log("");
  await testRPC(RPC_CUSTOM, "CUSTOM");
}

main().catch(console.error);
