import { ethers } from 'ethers';

const RPC = 'http://5.161.35.78:8545';
const provider = new ethers.JsonRpcProvider(RPC);

async function main() {
  console.log("Fetching block timestamps...");
  for (let i = 1725330; i <= 1725340; i++) {
    const block = await provider.getBlock(i);
    if (block) {
      console.log(`Block ${i} | Timestamp: ${block.timestamp} | Date: ${new Date(block.timestamp * 1000).toISOString()}`);
    }
  }
}

main().catch(console.error);
