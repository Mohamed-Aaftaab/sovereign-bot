import { ethers } from 'ethers';
const RPC = 'http://5.161.35.78:8545';
const provider = new ethers.JsonRpcProvider(RPC);

async function main() {
  const latest = await provider.getBlockNumber();
  const block = await provider.getBlock(latest, true);
  console.log("Block txs length:", block.transactions.length);
  if (block.transactions.length > 0) {
    console.log("First tx type:", typeof block.transactions[0]);
    console.log("First tx details:", block.transactions[0]);
  }
}
main();
