import fs from 'fs';
import { ethers } from 'ethers';

const RPC = 'http://5.161.35.78:8545';
const provider = new ethers.JsonRpcProvider(RPC);
const ME_EOA = '0xfB9C1BCAD029dB8Ef4fA9565760888926De65068'.toLowerCase();
const SHADOW_EOA = '0x541bb659df7daff414388118053f06e4c091801b'.toLowerCase();
const OUT_FILE = 'tx_output.txt';

async function check() {
  try {
    fs.writeFileSync(OUT_FILE, '=== Transaction Block Scan ===\n');
    const latest = await provider.getBlockNumber();
    fs.appendFileSync(OUT_FILE, `Latest block: ${latest}\nScanning last 150 blocks...\n`);

    const startBlock = latest - 150;
    const promises = [];
    for (let i = startBlock; i <= latest; i++) {
      promises.push((async (blockNum) => {
        try {
          const block = await provider.getBlock(blockNum, true);
          if (!block || !block.transactions) return null;
          const foundMe = [];
          const foundShadow = [];
          for (const tx of block.transactions) {
            if (typeof tx === 'string') continue;
            const from = tx.from?.toLowerCase();
            if (from === ME_EOA) {
              foundMe.push({ hash: tx.hash, gasPrice: tx.gasPrice, nonce: tx.nonce });
            } else if (from === SHADOW_EOA) {
              foundShadow.push({ hash: tx.hash, gasPrice: tx.gasPrice, nonce: tx.nonce });
            }
          }
          if (foundMe.length > 0 || foundShadow.length > 0) {
            return { blockNum, timestamp: block.timestamp, foundMe, foundShadow };
          }
        } catch {}
        return null;
      })(i));
    }
    const results = await Promise.all(promises);
    const sorted = results.filter(Boolean).sort((a, b) => a.blockNum - b.blockNum);
    for (const r of sorted) {
      let out = `\n[Block ${r.blockNum}] Time: ${new Date(r.timestamp * 1000).toISOString().slice(14, 19)}\n`;
      for (const tx of r.foundShadow) {
        out += `  - SHADOW Tx: ${tx.hash.slice(0, 18)}... | GasPrice: ${tx.gasPrice ? ethers.formatUnits(tx.gasPrice, 'gwei') + ' Gwei' : 'N/A'} | Nonce: ${tx.nonce}\n`;
      }
      for (const tx of r.foundMe) {
        out += `  - ME Tx:     ${tx.hash.slice(0, 18)}... | GasPrice: ${tx.gasPrice ? ethers.formatUnits(tx.gasPrice, 'gwei') + ' Gwei' : 'N/A'} | Nonce: ${tx.nonce}\n`;
      }
      fs.appendFileSync(OUT_FILE, out);
    }
    fs.appendFileSync(OUT_FILE, '\n=== Scan Complete ===\n');
    console.log("Scan completed successfully.");
  } catch (e) {
    fs.appendFileSync(OUT_FILE, `ERROR: ${e.message}\n`);
    console.error("Scan failed:", e);
  }
}
check();
