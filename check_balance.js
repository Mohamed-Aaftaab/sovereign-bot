import fs from 'fs';
import { ethers } from 'ethers';

const STATE_FILE = '.agent.json';
const RPC = 'http://5.161.35.78:8545';
const USDC_ADDR = '0xed38c197b319fdc067f4c3fb58eec1a733a36cf4';
const ERC20_ABI = ['function balanceOf(address) view returns (uint256)'];

async function check() {
  try {
    const s = JSON.parse(fs.readFileSync(STATE_FILE, 'utf8'));
    const provider = new ethers.JsonRpcProvider(RPC);
    const usdc = new ethers.Contract(USDC_ADDR, ERC20_ABI, provider);
    const bal = await usdc.balanceOf(s.tradingSafe);
    console.log(`Safe: ${s.tradingSafe}`);
    console.log(`USDC Balance: ${ethers.formatUnits(bal, 18)} USDC`);
  } catch (e) {
    console.error(e);
  }
}
check();
