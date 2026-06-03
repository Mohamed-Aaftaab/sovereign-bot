import { ethers } from 'ethers';

const RPC = 'http://5.161.35.78:8545';
const provider = new ethers.JsonRpcProvider(RPC);
const STARDUST_ADDR = '0x764Fa750E522312910b12959ABbF9eC142262209';

const TRANSFER_TOPIC = ethers.id("Transfer(address,address,uint256)");

async function main() {
  console.log(`Querying Transfer logs for STARDUST in blocks 1725320 to 1725335...`);
  
  const filter = {
    address: STARDUST_ADDR,
    topics: [TRANSFER_TOPIC],
    fromBlock: 1725320,
    toBlock: 1725335
  };
  
  const logs = await provider.getLogs(filter);
  console.log(`Found ${logs.length} transfer logs before block 1725336.`);
  
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
    
    const from = ethers.getAddress(ethers.dataSlice(log.topics[1], 12));
    const to = ethers.getAddress(ethers.dataSlice(log.topics[2], 12));
    const value = ethers.AbiCoder.defaultAbiCoder().decode(['uint256'], log.data)[0];
    
    const fromEOA = tx.from.toLowerCase();
    const label = fromEOA === '0xfb9c1bcad029db8ef4fa9565760888926de65068' ? 'ME' 
                : fromEOA === '0x541bb659df7daff414388118053f06e4c091801b' ? 'SHADOW' : 'OTHER';

    console.log(`\n[Block ${blockNum}] Tx Index: ${rec.index} | [${label}] Sender: ${tx.from} | GasPrice: ${ethers.formatUnits(tx.gasPrice, 'gwei')} Gwei`);
    console.log(`  Transfer: ${from} -> ${to} | Value: ${ethers.formatUnits(value, 18)}`);
  }
}

main().catch(console.error);
