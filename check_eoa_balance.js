import { ethers } from 'ethers';

const RPC = 'http://5.161.35.78:8545';
const provider = new ethers.JsonRpcProvider(RPC);
const EOA = '0xfB9C1BCAD029dB8Ef4fA9565760888926De65068';
const SAFE = '0x44316d6cc141b15cb957dce81faf2b5094f9ffa0';

async function main() {
  const eoaBal = await provider.getBalance(EOA);
  const safeBal = await provider.getBalance(SAFE);
  console.log(`EOA (${EOA}) ETH Balance: ${ethers.formatEther(eoaBal)} ETH`);
  console.log(`Safe (${SAFE}) ETH Balance: ${ethers.formatEther(safeBal)} ETH`);
}

main().catch(console.error);
