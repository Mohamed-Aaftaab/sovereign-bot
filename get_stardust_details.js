import { ethers } from 'ethers';

const RPC = 'http://5.161.35.78:8545';
const provider = new ethers.JsonRpcProvider(RPC);
const TX_HASH = '0x9249506ee0b90e24aa92a7809c3e3824036f8bc641575b2148648661c557907c';

const ROLES_ABI = [
  'function execTransactionWithRole(address to,uint256 value,bytes data,uint8 operation,bytes32 roleKey,bool shouldRevert) returns (bool)'
];
const TRADER_ABI = [
  'function tradeViaFactory(address factory,(bytes signature,bytes data,uint256 expiresAt,uint256 nonce) signature,(uint160 sqrtPriceLimit,uint256 minAmountOut) tradeLimits,uint256 ethValue) external'
];

const rolesIface = new ethers.Interface(ROLES_ABI);
const traderIface = new ethers.Interface(TRADER_ABI);

async function main() {
  const tx = await provider.getTransaction(TX_HASH);
  const rec = await provider.getTransactionReceipt(TX_HASH);
  
  console.log(`Transaction details:`);
  console.log(`  Block: ${tx.blockNumber}`);
  console.log(`  Index: ${rec.index}`);
  console.log(`  From: ${tx.from}`);
  console.log(`  GasPrice: ${ethers.formatUnits(tx.gasPrice, 'gwei')} Gwei`);
  
  // Decode roles call
  const parsedRoles = rolesIface.parseTransaction({ data: tx.data, value: tx.value });
  const innerData = parsedRoles.args[2]; // 'data' field
  
  // Decode trader call
  const parsedTrader = traderIface.parseTransaction({ data: innerData, value: 0n });
  const sigData = parsedTrader.args[1].data;
  
  const decoded = ethers.AbiCoder.defaultAbiCoder().decode(
    ['address', 'uint256', 'bool', 'bytes'], sigData
  );
  
  const tokenAddress = decoded[0];
  console.log(`\nSTARDUST Token Address from tx inputs: ${tokenAddress}`);
  
  // Query all Transfer logs on this token address in that block
  const TRANSFER_TOPIC = ethers.id("Transfer(address,address,uint256)");
  const filter = {
    address: tokenAddress,
    topics: [TRANSFER_TOPIC],
    fromBlock: tx.blockNumber,
    toBlock: tx.blockNumber
  };
  
  const logs = await provider.getLogs(filter);
  console.log(`\nFound ${logs.length} transfers in block ${tx.blockNumber}:`);
  
  const txCache = {};
  for (const log of logs) {
    const hash = log.transactionHash;
    if (!txCache[hash]) {
      const t = await provider.getTransaction(hash);
      const r = await provider.getTransactionReceipt(hash);
      txCache[hash] = { t, r };
    }
    const { t, r } = txCache[hash];
    
    const from = ethers.getAddress(ethers.dataSlice(log.topics[1], 12));
    const to = ethers.getAddress(ethers.dataSlice(log.topics[2], 12));
    const value = ethers.AbiCoder.defaultAbiCoder().decode(['uint256'], log.data)[0];
    
    const fromEOA = t.from.toLowerCase();
    const label = fromEOA === '0xfb9c1bcad029db8ef4fa9565760888926de65068' ? 'ME' 
                : fromEOA === '0x541bb659df7daff414388118053f06e4c091801b' ? 'SHADOW' : 'OTHER';

    console.log(`  [Index ${r.index}] [${label}] Sender: ${t.from} | GasPrice: ${ethers.formatUnits(t.gasPrice, 'gwei')} Gwei`);
    console.log(`    Transfer: ${from} -> ${to} | Value: ${ethers.formatUnits(value, 18)}`);
  }
}

main().catch(console.error);
