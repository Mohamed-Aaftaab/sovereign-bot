import { ethers } from 'ethers';

const API = 'https://alpha.creator.bid/api';

async function fetchJson(path) {
  const r = await fetch(API + path);
  if (!r.ok) return null;
  return await r.json();
}

async function runSpy() {
  let lastToken = null;
  console.log('[SPY] Started! Monitoring battles for TWAP Whales (Jirachi)...');

  while (true) {
    await new Promise(r => setTimeout(r, 5000));
    try {
      const game = await fetchJson('/game');
      if (!game || !game.token) continue;
      
      const token = game.token.address;
      if (token !== lastToken) {
        console.log(`\n[SPY] New battle detected: ${game.token.symbol} (${token.slice(0, 8)}...)`);
        lastToken = token;
      }

      // If the battle is ending or ended, fetch the trades
      if (!game.active && game.status === 'ended') {
        const trades = await fetchJson(`/tokens/${token}/trades`);
        if (!trades || trades.length === 0) continue;

        console.log(`[SPY] Battle ended. Analyzing trades...`);
        
        // Group by trader
        const traders = {};
        for (const t of trades) {
          if (!traders[t.tx_from]) traders[t.tx_from] = { address: t.tx_from, buys: [], sells: [] };
          if (t.is_buy) traders[t.tx_from].buys.push(t);
          else traders[t.tx_from].sells.push(t);
        }

        // Find the whales (TWAP bots like Jirachi)
        for (const addr in traders) {
          const t = traders[addr];
          const totalBuy = t.buys.reduce((sum, tx) => sum + parseFloat(ethers.formatUnits(tx.amount_in, 18)), 0);
          const totalSell = t.sells.reduce((sum, tx) => sum + parseFloat(ethers.formatUnits(tx.amount_out, 18)), 0);
          const pnl = totalSell - totalBuy;
          
          const isSovereign = addr.toLowerCase() === '0xD8c47eb780B454bbBa9D1B47f7d187BD618EB176'.toLowerCase();
          if ((totalBuy > 500 && t.buys.length >= 2) || isSovereign) {
            console.log(`\n======================================`);
            if (isSovereign) {
              console.log(`[SPY] 👑 SOVEREIGN DETECTED: ${addr}`);
            } else {
              console.log(`[SPY] 🐋 WHALE DETECTED: ${addr}`);
            }
            console.log(`[SPY] Total Capital Used: ${totalBuy.toFixed(2)} USDC`);
            console.log(`[SPY] Total PnL: ${pnl >= 0 ? '+' : ''}${pnl.toFixed(2)} USDC`);
            console.log(`[SPY] TWAP Buy Chunks: ${t.buys.length}`);
            console.log(`[SPY] TWAP Sell Chunks: ${t.sells.length}`);
            console.log(`--------------------------------------`);
            console.log(`[SPY] BUY SEQUENCE:`);
            
            // Sort chronologically (API might be reverse chronological, so sort by timestamp)
            t.buys.sort((a, b) => a.timestamp - b.timestamp).forEach(buy => {
                const amt = parseFloat(ethers.formatUnits(buy.amount_in, 18)).toFixed(2);
                console.log(`  -> Buy ${amt} USDC at timestamp ${buy.timestamp}`);
            });
            
            console.log(`[SPY] SELL SEQUENCE:`);
            t.sells.sort((a, b) => a.timestamp - b.timestamp).forEach(sell => {
                const amt = parseFloat(ethers.formatUnits(sell.amount_in, 18)).toFixed(2); // Wait, token amount is in amount_in for sells? Let's just print timestamp
                console.log(`  -> Sell at timestamp ${sell.timestamp}`);
            });
            console.log(`======================================\n`);
          }
        }
        
        // Wait for the next battle to start so we don't spam the console for this ended battle
        while (true) {
            await new Promise(r => setTimeout(r, 5000));
            const nextGame = await fetchJson('/game');
            if (nextGame && nextGame.token && nextGame.token.address !== token) {
                break;
            }
        }
      }
    } catch (e) {
      // ignore
    }
  }
}

runSpy();
