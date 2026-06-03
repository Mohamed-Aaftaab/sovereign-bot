import fs from 'fs';
import { ethers } from 'ethers';

const STATE_FILE = '.agent.json';
const RPC = 'http://5.161.35.78:8545';
const USDC_ADDR = '0xed38c197b319fdc067f4c3fb58eec1a733a36cf4';
const RIFT_ADDR = '0x215349638d2ae7fa240381af6837179089233f48';

const ERC20_ABI = [
  'function balanceOf(address) view returns (uint256)',
  'function decimals() view returns (uint8)',
  'function symbol() view returns (string)'
];

async function check() {
  try {
    const s = JSON.parse(fs.readFileSync(STATE_FILE, 'utf8'));
    const provider = new ethers.JsonRpcProvider(RPC);
    const safe = s.tradingSafe;
    console.log(`Safe address: ${safe}`);

    const usdc = new ethers.Contract(USDC_ADDR, ERC20_ABI, provider);
    const rift = new ethers.Contract(RIFT_ADDR, ERC20_ABI, provider);

    const usdcDec = await usdc.decimals();
    const riftDec = await rift.decimals();
    const usdcSym = await usdc.symbol();
    const riftSym = await rift.symbol();

    const usdcBal = await usdc.balanceOf(safe);
    const riftBal = await rift.balanceOf(safe);

    console.log(`${usdcSym} Balance: ${ethers.formatUnits(usdcBal, usdcDec)} (decimals: ${usdcDec})`);
    console.log(`${riftSym} Balance: ${ethers.formatUnits(riftBal, riftDec)} (decimals: ${riftDec})`);

    // Let's check safe ETH balance too
    const ethBal = await provider.getBalance(safe);
    console.log(`Safe ETH Balance: ${ethers.formatEther(ethBal)} ETH`);
    
    // Wallet EOA balance
    const wallet = new ethers.Wallet(s.pk, provider);
    const eoaBal = await provider.getBalance(wallet.address);
    console.log(`EOA Address: ${wallet.address}`);
    console.log(`EOA ETH Balance: ${ethers.formatEther(eoaBal)} ETH`);

  } catch (e) {
    console.error(e);
  }
}
check();
