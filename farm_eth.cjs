const fs = require('fs');
const { ethers } = require('ethers');

const API = 'https://alpha.creator.bid/api';
const RPC = 'http://5.161.35.78:8545';
const provider = new ethers.JsonRpcProvider(RPC, 42069, { staticNetwork: true });

async function api(path, { method = 'GET', body, token } = {}) {
  const headers = { 'Content-Type': 'application/json' };
  if (token) headers.Authorization = 'Bearer ' + token;
  const r = await fetch(API + path, { method, headers, body: body ? JSON.stringify(body) : undefined });
  return r.json();
}

async function main() {
  const state = JSON.parse(fs.readFileSync('.agent.json', 'utf8'));
  const mainWallet = new ethers.Wallet(state.pk, provider);
  const tempWallet = ethers.Wallet.createRandom().connect(provider);
  
  console.log('Main wallet:', mainWallet.address);
  console.log('Temp wallet:', tempWallet.address);

  // Send initial balance out to temp wallet to trigger the first refill
  let initialBal = await provider.getBalance(mainWallet.address);
  if (initialBal > ethers.parseEther("0.1")) {
      const cost = 21000n * (await provider.getFeeData()).gasPrice;
      const tx = await mainWallet.sendTransaction({
          to: tempWallet.address,
          value: initialBal - cost
      });
      console.log('Draining initial balance to temp wallet...', tx.hash);
      await tx.wait();
  }

  for (let i = 0; i < 5; i++) {
    console.log(`\n--- Cycle ${i + 1} ---`);
    console.log('Requesting refill...');
    const refillRes = await api('/agents/refill', { method: 'POST', body: { address: mainWallet.address }, token: state.agentJwt });
    console.log('Refill response:', refillRes);
    
    // Wait for refill to land
    await new Promise(r => setTimeout(r, 6000));
    
    let bal = await provider.getBalance(mainWallet.address);
    console.log('Main balance after refill:', ethers.formatEther(bal));
    
    // Transfer out 0.49 ETH to temp wallet to go below floor
    if (bal >= ethers.parseEther("0.49")) {
        const tx = await mainWallet.sendTransaction({
            to: tempWallet.address,
            value: ethers.parseEther("0.49")
        });
        console.log('Transferred 0.49 ETH to temp wallet. Hash:', tx.hash);
        await tx.wait();
    }
  }

  // Return all funds from temp wallet to main wallet
  let tempBal = await provider.getBalance(tempWallet.address);
  console.log('\nTemp wallet total balance:', ethers.formatEther(tempBal));
  
  if (tempBal > ethers.parseEther("0.01")) {
      const gasLimit = 21000n;
      const feeData = await provider.getFeeData();
      const gasPrice = feeData.gasPrice;
      const cost = gasLimit * gasPrice;
      
      const tx = await tempWallet.sendTransaction({
          to: mainWallet.address,
          value: tempBal - cost
      });
      console.log('Transferring all stacked ETH back to main wallet! Hash:', tx.hash);
      await tx.wait();
  }
  
  let finalBal = await provider.getBalance(mainWallet.address);
  console.log('\n💎 FINAL MAIN BALANCE:', ethers.formatEther(finalBal));
}

main().catch(console.error);
