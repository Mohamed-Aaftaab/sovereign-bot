import { ethers } from 'ethers';

const RPC = 'http://5.161.35.78:8545';
const provider = new ethers.JsonRpcProvider(RPC);
const STARDUST_ADDR = ethers.getAddress('0x764fa750e502ddf8217693fCc3850Be3585ed23F4DF7E3A1');

const TRANSFER_TOPIC = ethers.id("Transfer(address,address,uint256)");

async function main() {
  console.log(`Querying Transfer logs for STARDUST (${STARDUST_ADDR}) in blocks 1725300 to 1725360...`);
  
  const filter = {
    address: STARDUST_ADDR,
    topics: [TRANSFER_TOPIC],
    fromBlock: 1725300,
    toBlock: 1725360
  };
  
  const logs = await provider.getLogs(filter);
  console.log(`Found ${logs.length} transfer logs.`);
  
  const txCache = {};
  for (const log of logs) {
    const txHash = log.transactionHash;
    const blockNum = log.blockNumber;
    
    if (!txCache[txHash]) {
      const tx = await provider.getTransaction(txHash);
      const rec = await provider.getTransactionReceipt(txHash);
      txCache[txHash] = { tx, rec };
    }
    
    const { tx, rec } = txCache[txHash];
    
    // Decode transfer event arguments (from log.topics and log.data)
    const from = ethers.zeroPadValue(log.topics[1], 20);
    const to = ethers.zeroPadValue(log.topics[2], 20);
    const value = ethers.AbiCoder.defaultAbiCoder().decode(['uint256'], log.data)[0];

    console.log(`\n[Block ${blockNum}] Tx Index: ${rec.index} | Hash: ${txHash}`);
    console.log(`  From: ${from} -> To: ${to} | Value: ${ethers.formatUnits(value, 18)}`);
    console.log(`  Tx Sender (EOA): ${tx.from} | GasPrice: ${ethers.formatUnits(tx.gasPrice, 'gwei')} Gwei | Status: ${rec.status === 1 ? 'SUCCESS' : 'REVERT'}`);
  }
}

main().catch(console.error);
