import { ethers } from 'ethers';

const RPC = 'http://5.161.35.78:8545';
const provider = new ethers.JsonRpcProvider(RPC);
const ME_EOA = '0xfB9C1BCAD029dB8Ef4fA9565760888926De65068'.toLowerCase();

async function main() {
  console.log("Scanning blocks 1725800 to 1725879 for our EOA transactions...");

  const promises = [];
  for (let i = 1725800; i <= 1725879; i++) {
    promises.push((async (blockNum) => {
      try {
        const block = await provider.getBlock(blockNum);
        if (!block || !block.transactions) return null;
        const found = [];
        for (const txHash of block.transactions) {
          const tx = await provider.getTransaction(txHash);
          if (tx && tx.from?.toLowerCase() === ME_EOA) {
            found.push({ hash: tx.hash, gasPrice: tx.gasPrice, index: tx.transactionIndex, nonce: tx.nonce });
          }
        }
        if (found.length > 0) {
          return { blockNum, timestamp: block.timestamp, txs: found };
        }
      } catch (e) {
        // ignore
      }
      return null;
    })(i));
  }

  const results = await Promise.all(promises);
  const sorted = results.filter(Boolean).sort((a, b) => a.blockNum - b.blockNum);
  
  if (sorted.length === 0) {
    console.log("No transactions from our EOA found in that block range.");
    return;
  }

  for (const r of sorted) {
    console.log(`\n[Block ${r.blockNum}] Time: ${new Date(r.timestamp * 1000).toISOString().slice(14, 19)}`);
    for (const tx of r.txs) {
      console.log(`  - ME Tx Index: ${tx.index} | GasPrice: ${ethers.formatUnits(tx.gasPrice, 'gwei')} Gwei | Hash: ${tx.hash} | Nonce: ${tx.nonce}`);
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
