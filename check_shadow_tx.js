import { ethers } from 'ethers';

const RPC = 'http://5.161.35.78:8545';
const provider = new ethers.JsonRpcProvider(RPC);
const SHADOW_EOA = '0x541bb659df7daff414388118053f06e4c091801b'.toLowerCase();

async function main() {
  const latest = await provider.getBlockNumber();
  console.log(`Latest block: ${latest}. Searching last 150 blocks for SHADOW transactions...`);

  const promises = [];
  for (let i = latest - 150; i <= latest; i++) {
    promises.push((async (blockNum) => {
      try {
        const block = await provider.getBlock(blockNum);
        if (!block || !block.transactions) return null;
        const found = [];
        for (const txHash of block.transactions) {
          const tx = await provider.getTransaction(txHash);
          if (tx && tx.from?.toLowerCase() === SHADOW_EOA) {
            found.push({ hash: tx.hash, gasPrice: tx.gasPrice, index: tx.transactionIndex, nonce: tx.nonce });
          }
        }
        if (found.length > 0) {
          return { blockNum, timestamp: block.timestamp, txs: found };
        }
      } catch (e) {
        // console.error(`Error block ${blockNum}:`, e.message);
      }
      return null;
    })(i));
  }

  const results = await Promise.all(promises);
  const sorted = results.filter(Boolean).sort((a, b) => a.blockNum - b.blockNum);
  
  if (sorted.length === 0) {
    console.log("No transactions from Shadow found in the last 150 blocks.");
    return;
  }

  for (const r of sorted) {
    console.log(`\n[Block ${r.blockNum}] Time: ${new Date(r.timestamp * 1000).toISOString().slice(14, 19)}`);
    for (const tx of r.txs) {
      console.log(`  - SHADOW Tx Index: ${tx.index} | GasPrice: ${ethers.formatUnits(tx.gasPrice, 'gwei')} Gwei | Hash: ${tx.hash} | Nonce: ${tx.nonce}`);
      try {
        const rec = await provider.getTransactionReceipt(tx.hash);
        console.log(`    Status: ${rec.status === 1 ? 'SUCCESS' : 'REVERT'} | GasUsed: ${rec.gasUsed.toString()}`);
      } catch (e) {
        console.log(`    Receipt error: ${e.message}`);
      }
    }
  }
}

main().catch(console.error);
