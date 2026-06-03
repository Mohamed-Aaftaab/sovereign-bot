import { ethers } from 'ethers';

const RPC = 'http://5.161.35.78:8545';
const provider = new ethers.JsonRpcProvider(RPC);
const MY_PREFIX = '0x9249506ee0b90e24';

async function main() {
  const latest = await provider.getBlockNumber();
  console.log(`Latest block: ${latest}. Searching last 150 blocks for tx starting with ${MY_PREFIX}...`);

  let foundTxHash = null;
  let foundBlockNum = null;

  for (let i = latest; i >= latest - 150; i--) {
    const block = await provider.getBlock(i);
    if (!block || !block.transactions) continue;
    for (const txHash of block.transactions) {
      if (txHash.toLowerCase().startsWith(MY_PREFIX.toLowerCase())) {
        foundTxHash = txHash;
        foundBlockNum = i;
        break;
      }
    }
    if (foundTxHash) break;
  }

  if (!foundTxHash) {
    console.log("Could not find our transaction hash in the last 150 blocks.");
    return;
  }

  console.log(`Found transaction: ${foundTxHash} in block ${foundBlockNum}`);

  const receipt = await provider.getTransactionReceipt(foundTxHash);
  console.log(`Our Tx Index: ${receipt.index}`);
  console.log(`Our Tx Status: ${receipt.status === 1 ? 'Success' : 'Fail'}`);
  console.log(`Our Gas Used: ${receipt.gasUsed.toString()}`);

  const block = await provider.getBlock(foundBlockNum);
  console.log(`\n--- Block ${foundBlockNum} (Total Tx Count: ${block.transactions.length}) ---`);

  // Fetch all txs in this block concurrently
  const txPromises = block.transactions.map(h => provider.getTransaction(h));
  const txs = await Promise.all(txPromises);

  // Fetch receipts concurrently to see execution results
  const receiptPromises = block.transactions.map(h => provider.getTransactionReceipt(h));
  const receipts = await Promise.all(receiptPromises);

  for (let idx = 0; idx < txs.length; idx++) {
    const tx = txs[idx];
    const rec = receipts[idx];
    if (!tx || !rec) continue;
    
    const from = tx.from.toLowerCase();
    const isMe = from === '0xfb9c1bcad029db8ef4fa9565760888926de65068';
    const isShadow = from === '0x541bb659df7daff414388118053f06e4c091801b';
    
    let label = 'OTHER';
    if (isMe) label = 'ME';
    if (isShadow) label = 'SHADOW';

    console.log(`[Index ${tx.transactionIndex}] [${label}] EOA: ${tx.from} | GasPrice: ${ethers.formatUnits(tx.gasPrice, 'gwei')} Gwei | Hash: ${tx.hash} | Status: ${rec.status === 1 ? 'SUCCESS' : 'REVERT'}`);
  }
}

main().catch(console.error);
