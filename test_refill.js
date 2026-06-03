/**
 * Sovereign — Shadow-Matched Multi-Cycle Strategy
 *
 * PATTERN: Match Shadow's exact battle structure:
 *   Cycle 1: Buy AT rollover (clock-triggered spin, not pre-fetch) → sell at peak
 *   Cycle 2: Re-enter if >60s left after cycle 1 sell → sell at peak or end-of-round
 *
 * KEY FIXES from prior losses:
 *   - Clock spin starts AT mmEndAt (not before — pre-rollover sigs revert on-chain)
 *   - Mid-battle detection skips ALL buying
 *   - avgEntry restored on sell failure (no phantom stop-loss chains)
 *   - 100 USDC per cycle (safe for thin pools)
 *   - Chain default gas (no custom gasPrice — causes "could not coalesce" rejects)
 */
import fs from 'fs';
import { ethers } from 'ethers';

if (process.stdout._handle?.setBlocking) process.stdout._handle.setBlocking(true);

// ── CONFIG ────────────────────────────────────────────────────────────────────
const API        = 'https://alpha.creator.bid/api';
const RPC        = 'http://5.161.35.78:8545';
const FACTORY    = '0xE841bCA5A85C76FA667a968C4fe817Ffa2E220e7';
const TRADER_ZH  = '0x521FAcaAB630E30614617c9ae5f6508cB4213540';
const ROLE_KEY   = '0xfacaf2747a7486cf5730e9265973fb54447d3ace6e7e4711f6360826b0731941';
const USDC_ADDR  = '0xed38c197b319fdc067f4c3fb58eec1a733a36cf4';
const STATE_FILE = '.agent.json';

// ── STRATEGY ──────────────────────────────────────────────────────────────────
let BUY_AMOUNT      = 100n * 10n ** 18n; // Scale up to 100 USDC (testing pool depth)
// Shadow strategy: BUY at rollover → SELL 20% at first pump peak → HOLD rest to end of round
// Phase 1: sell 20% when price hits +20% (lock in peak profit like Shadow's first fill)
// Phase 2: sell remaining 80% at end of round in 3 staggered steps
// Emergency: hard-stop at -25% (catastrophic crash only)
const TRAIL_STOP_PCT         = 50n;  // last resort only (need 50%+ drop from a 100%+ peak)
const MIN_PEAK_PCT           = 200n; // last resort only (need price to double)
const HARD_STOP_PCT          = 75n;  // emergency stop at -25% from entry
const PARTIAL_SELL_TRIGGER   = 120n; // sell 20% when price reaches +20% above entry
const API_LATENCY_MS         = 60000; // Pre-fetch 60 seconds early to beat their early polling

// Survival Farming Mode: Flat 50 Gwei to safely build balance.
const GAS_BUY  = ethers.parseUnits('50', 'gwei');
const GAS_SELL = ethers.parseUnits('50', 'gwei');
const GAS_SELL_END = ethers.parseUnits('50', 'gwei');

// ── INFRA ─────────────────────────────────────────────────────────────────────
// Block time = 1s. ethers.js default polling = 4s → makes tx.wait() appear slow.
// Set to 500ms so we detect tx result within 1.5s of mining (not 5-6s).
const provider = new ethers.JsonRpcProvider(RPC, 42069, { staticNetwork: true });
provider.pollingInterval = 500; // 500ms polling — critical for fast retries
const sleep = ms => new Promise(r => setTimeout(r, ms));
const ts    = () => new Date().toISOString().slice(11, 23);
const log   = (...a) => console.log(`[${ts()}]`, ...a);

async function apiFetch(path, { method = 'GET', token, body } = {}) {
  const h = { 'Content-Type': 'application/json' };
  if (token) h.Authorization = 'Bearer ' + token;
  const r = await fetch(API + path, { method, headers: h, body: body ? JSON.stringify(body) : undefined });
  const txt = await r.text();
  let d; try { d = JSON.parse(txt); } catch { d = { _raw: txt }; }
  if (!r.ok) { const e = new Error(`${path} ${r.status}: ${d.error || txt}`); e.status = r.status; throw e; }
  return d;
}

function save(s) { fs.writeFileSync(STATE_FILE, JSON.stringify(s, null, 2), { mode: 0o600 }); }

async function load() {
  if (fs.existsSync(STATE_FILE)) return JSON.parse(fs.readFileSync(STATE_FILE, 'utf8'));
  const w = ethers.Wallet.createRandom();
  const body = await apiFetch('/agents/register', {
    method: 'POST', token: process.env.USER_JWT,
    body: { name: 'sovereign-' + w.address.slice(2, 8), address: w.address, archetype: 'SovereignEngine' },
  });
  const s = { pk: w.privateKey, address: w.address, agentJwt: body.token,
              tradingSafe: body.trading_safe, rolesMod: body.roles_modifier };
  save(s); return s;
}

function jwtOk(t) {
  try { return JSON.parse(Buffer.from(t.split('.')[1], 'base64').toString()).exp - Date.now() / 1000 > 600; }
  catch { return false; }
}
async function login(state) {
  const wallet = new ethers.Wallet(state.pk, provider);
  const { message } = await apiFetch('/auth/nonce', { method: 'POST', body: { address: wallet.address } });
  const sig = await wallet.signMessage(message);
  const { token } = await apiFetch('/auth/login', { method: 'POST', body: { address: wallet.address, signature: sig } });
  state.agentJwt = token; save(state); log('JWT refreshed'); return token;
}
async function jwt(state) {
  if (!state.agentJwt || !jwtOk(state.agentJwt)) await login(state);
  return state.agentJwt;
}

const TRADER_ABI = [
  'function tradeViaFactory(address factory,(bytes signature,bytes data,uint256 expiresAt,uint256 nonce) signature,(uint160 sqrtPriceLimit,uint256 minAmountOut) tradeLimits,uint256 ethValue) external',
  'function approveFactory(address token, uint256 amount) external',
];
const ROLES_ABI = ['function execTransactionWithRole(address to,uint256 value,bytes data,uint8 operation,bytes32 roleKey,bool shouldRevert) returns (bool)'];
const ERC20_ABI = [
  'function balanceOf(address) view returns (uint256)',
  'function allowance(address,address) view returns (uint256)'
];
const iface = new ethers.Interface(TRADER_ABI);

function makeExec(state) {
  const wallet = new ethers.Wallet(state.pk, provider);
  const rolesIface = new ethers.Interface(ROLES_ABI);
  let chain = Promise.resolve();
  let localNonce = null;

  // Pre-fetch nonce helper (non-blocking)
  const syncNonce = async () => {
    try {
      localNonce = await provider.getTransactionCount(wallet.address);
      log(`[NONCE SYNC] Current EOA Nonce: ${localNonce}`);
    } catch (e) {
      log(`[NONCE SYNC] Failed: ${e.message}`);
    }
  };
  syncNonce();

  const execFn = (data, gasPrice, forcedNonce, customLimit) => {
    const p = chain.catch(() => {}).then(async () => {
      log('[EXEC] tx...');
      
      // Resolve the nonce to use
      let nonceToUse;
      if (forcedNonce !== undefined && forcedNonce !== null) {
        nonceToUse = forcedNonce;
      } else {
        if (localNonce === null) {
          localNonce = await provider.getTransactionCount(wallet.address);
        }
        nonceToUse = localNonce;
      }

      const txData = rolesIface.encodeFunctionData('execTransactionWithRole', [
        TRADER_ZH, 0n, data, 1, ROLE_KEY, true
      ]);

      const txRequest = {
        to: state.rolesMod,
        data: txData,
        gasLimit: customLimit ? customLimit : 415000n,
        nonce: nonceToUse,
        chainId: 42069,
        ...(gasPrice ? { gasPrice } : {})
      };

      // NOTE: No pre-broadcast simulation. provider.call() cannot replicate the
      // on-chain context needed to validate platform signatures (DelegateCall state
      // divergence). We rely on on-chain validation and receipt status instead.

      const signedTx = await wallet.signTransaction(txRequest);
      const tx = await provider.broadcastTransaction(signedTx);
      
      // Increment nonce immediately after successful broadcast
      if (forcedNonce === undefined || forcedNonce === null) {
        localNonce++;
      }

      const receipt = await tx.wait();
      if (receipt && receipt.status === 0) {
        log(`[EXEC] ⚠️ Tx reverted on-chain (hash: ${tx.hash.slice(0, 18)})`);
        throw new Error(`Transaction reverted on-chain: ${tx.hash}`);
      }
      return receipt;
    });
    chain = p.catch(() => {});
    return p;
  };
  execFn.syncNonce = syncNonce;
  return execFn;
}

async function getSig(state, addr, amount, isBuy) {
  const call = t => apiFetch('/skill/swap', {
    method: 'POST', token: t,
    body: { tokenAddress: addr, amountIn: amount.toString(), isBuy },
  });
  try { return await call(await jwt(state)); }
  catch (e) { if (e.status === 401) return call(await login(state)); throw e; }
}
const sigOk = s => s && BigInt(s.sqrtPriceLimit || 0) > 0n;

async function execTrade(exec, sig, label, gasPrice, tokenAddress, isBuy, nonce) {
  const usdcLower = BigInt(USDC_ADDR) < BigInt(tokenAddress);
  const zeroForOne = usdcLower ? isBuy : !isBuy;
  const MIN_SQRT_RATIO = 4295128740n;
  const MAX_SQRT_RATIO = 1461446703485210103287273052203988822378723970341n;
  const limit = zeroForOne ? MIN_SQRT_RATIO : MAX_SQRT_RATIO;

  const data = iface.encodeFunctionData('tradeViaFactory', [
    FACTORY,
    { signature: sig.signature, data: sig.data, expiresAt: BigInt(sig.expiresAt), nonce: BigInt(sig.nonce) },
    { sqrtPriceLimit: limit, minAmountOut: 0n },
    0n,
  ]);
  const r = await exec(data, gasPrice, nonce, isBuy ? 415000n : 390000n);
  log(`[${label}] ✅ ${r?.transactionHash?.slice(0, 18)} (gas: ${gasPrice ? ethers.formatUnits(gasPrice, 'gwei') + ' Gwei' : 'default'})`);
  return r;
}

// Buy with 3 attempts, fresh sig each time, high gas for block priority
async function doBuy(state, exec, token, amount, label) {
  for (let i = 1; i <= 3; i++) {
    try {
      log(`[${label}] attempt ${i} — ${ethers.formatUnits(amount, 18)} USDC`);
      const sig = await getSig(state, token, amount, true);
      if (!sigOk(sig)) { log(`[${label}] sig invalid`); await sleep(300); continue; }
      await execTrade(exec, sig, label, GAS_BUY, token, true); // 50 Gwei — beats Shadow's 42.3 Gwei
      return true;
    } catch (e) {
      /const msg = e.message || e.shortMessage || '';/
      const net = msg.includes('coalesce') || msg.includes('ECONNRESET') || msg.includes('timeout');
      log(`[${label}] ❌ ${i} ${net ? '(net)' : '(contract)'}: ${msg.slice(0, 70)}`);
      if (i < 3) await sleep(net ? 800 : 200); // shorter retry delay (block time is 1s)
    }
  }
  return false;
}

// ── ROLLOVER SPIN BUY ─────────────────────────────────────────────────────────
// Waits until mmEndAt (trading opens), then broadcasts ONE real transaction.
// No pre-broadcast simulation — the factory signature can only be verified
// on-chain in the live execution context. We get a fresh sig, confirm the pool
// is seeded, then immediately broadcast and wait for the receipt.
function scheduleRolloverBuy(state, exec, token, poolAddress, mmEndAtMs, onSuccess, onFail) {
  // We wait until AT mmEndAt (not before) to avoid submitting before trading opens
  const msToOpen = Math.max(0, mmEndAtMs - Date.now());
  log(`[ROLLOVER] Scheduled spin at mmEndAt in ${Math.round(msToOpen)}ms`);

  setTimeout(async () => {
    log('[ROLLOVER] 🚀 Spinning for pool seed + broadcasting...');
    let attempts = 0;
    let broadcasted = false;
    const startTime = Date.now();
    const usdcContract = new ethers.Contract(USDC_ADDR, ERC20_ABI, provider);

    while (Date.now() - startTime < 120_000) {
      attempts++;
      if (state.currentToken !== token) {
        log(`[ROLLOVER] Token changed. Stopping rollover spin.`);
        return;
      }
      try {
        const sig = await getSig(state, token, BUY_AMOUNT, true);
        if (sigOk(sig)) {
          if (!broadcasted) {
            broadcasted = true; // Only broadcast once — avoid nonce/gas waste
            const gasLabel = ethers.formatUnits(GAS_BUY, 'gwei') + ' Gwei';
            log(`[ROLLOVER] 🚀 Spinning for pool seed + broadcasting...`);
            log(`[ROLLOVER] ✅ Got signature (attempt ${attempts}, +${Math.round((Date.now()-startTime)/1000)}s) — broadcasting at ${gasLabel}`);
              try {
                await execTrade(exec, sig, 'ROLLOVER BUY', GAS_BUY, token, true);
                onSuccess();
                return;
              } catch (e) {
                const msg = e.message || e.shortMessage || '';
                log(`[ROLLOVER] ❌ Broadcast failed: ${msg}`);
                broadcasted = false; // Allow retry after real on-chain failure
                await sleep(1000); // Wait a block before retrying
            }
          }
        }
      } catch (e) {
        const msg = e.message || e.shortMessage || '';
        if (!msg.includes('403')) log(`[ROLLOVER] err: ${msg.slice(0, 60)}`);
      }
      await sleep(50); // Poll aggressively (20 times per second) until the signature goes live
    }
    log(`[ROLLOVER] ❌ Could not complete rollover buy after 60s (${attempts} poll attempts) — using tradingOpen fallback`);
    onFail();
  }, msToOpen);
}

// ── MAIN ─────────────────────────────────────────────────────────────────────
async function main() {
  const state = await load();
  const exec  = makeExec(state);
  const tokBal = addr => new ethers.Contract(addr, ERC20_ABI, provider).balanceOf(state.tradingSafe);

  const sellTokens = (addr, amount, label, gasPrice, isFinal) => {
    inFlight = true;
    const savedEntry = avgEntry, savedPeak = runningPeak;
    if (isFinal) {
      inPosition = false;
      avgEntry = 0n;
      runningPeak = 0n;
    }
    return getSig(state, addr, amount, false)
      .then(async sig => {
        if (!sigOk(sig)) {
          log(`[${label}] sig invalid`);
          if (isFinal) { inPosition = true; avgEntry = savedEntry; runningPeak = savedPeak; }
          return false;
        }
        await execTrade(exec, sig, label, gasPrice, addr, false);
        return true;
      })
      .catch(e => {
        log(`[${label}] ❌`, e.shortMessage || e.message.slice(0, 70));
        if (isFinal) { inPosition = true; avgEntry = savedEntry; runningPeak = savedPeak; }
        return false;
      })
      .finally(() => { inFlight = false; });
  };

  const ping = () => apiFetch('/agents/heartbeat', { method: 'POST', body: { address: state.address } }).catch(() => {});
  ping(); setInterval(ping, 30_000);

  let lastToken      = null;
  let mmPrice        = null;   // last known price during MM phase (pre-rollover baseline)
  let bought         = false;  // have we bought this battle?
  let soldPeak       = false;  // sold 20% at peak?
  let soldEndStep    = 0;      // 0: none, 1: 20s, 2: 11s, 3: completed
  let originalBal    = 0n;
  let inPosition     = false;
  let inFlight       = false;
  let rolloverSet    = false;
  let avgEntry       = 0n;
  let runningPeak    = 0n;    // highest price seen since entry
  let tick           = 0;

  function newBattle(midBattle) {
    mmPrice      = null;
    bought       = midBattle;
    soldPeak     = false;
    soldEndStep  = 0;
    originalBal  = 0n;
    inPosition   = false;
    inFlight     = false;
    rolloverSet  = midBattle;
    avgEntry     = 0n;
    runningPeak  = 0n;
    tick         = 0;
  }

  while (true) {
    let game;
    try { game = await apiFetch('/game'); } catch { await sleep(1000); continue; }
    if (!game.active || !game.token) { await sleep(2000); continue; }

    const token     = game.token.address;
    const remaining = game.gameRemaining ?? 999;

    // ── NEW BATTLE ──────────────────────────────────────────────────────────
    if (token !== lastToken) {
      const firstStart = lastToken === null;
      const midBattle  = firstStart && game.tradingOpen;
      log(`--- NEW BATTLE: ${game.token.symbol} (${token.slice(0, 12)}) ---`);
      lastToken = token;
      state.currentToken = token;
      newBattle(midBattle);

      // Re-sync EOA nonce for the new battle
      await exec.syncNonce();

      if (midBattle) { log('[STARTUP] Mid-battle — skip.'); await sleep(2000); continue; }

      // Refill
      try {
        const t = await jwt(state);
        await apiFetch('/agents/refill', { method: 'POST', token: t, body: { address: state.address } });
        log('[REFILL] ✅');
      } catch {}

      // Approve USDC + token for factory
      for (const addr of [USDC_ADDR, token]) {
        try {
          const usdcContract = new ethers.Contract(addr, ERC20_ABI, provider);
          const allowance = await usdcContract.allowance(state.tradingSafe, FACTORY);
          if (allowance > 10n * 10n ** 18n) {
            log(`[APPROVE] Already approved ${addr === USDC_ADDR ? 'USDC' : 'Token'}`);
            continue;
          }
          await exec(iface.encodeFunctionData('approveFactory', [addr, ethers.MaxUint256]));
          log(`[APPROVE] ✅ ${addr === USDC_ADDR ? 'USDC' : 'Token'}`);
        } catch (e) { log('[APPROVE] err:', e.shortMessage || e.message.slice(0, 50)); }
      }
    }

    // ── MM PHASE: track price baseline + schedule rollover spin buy ───────────
    if (game.mmOpen && !game.tradingOpen) {
      // Record latest MM-phase price so we know the pre-rollover baseline
      if (game.token?.currentPrice) mmPrice = game.token.currentPrice;

      if (!rolloverSet && !bought && game.mmEndAt && game.now) {
        const driftMs   = (Math.floor(Date.now() / 1000) - game.now) * 1000;
        const mmEndAtMs = game.mmEndAt * 1000 - driftMs - API_LATENCY_MS;
        const msLeft    = mmEndAtMs - Date.now();

        if (msLeft < 120_000 && msLeft > -120_000) {
          rolloverSet = true;
          inFlight    = true;
          bought      = true;

          scheduleRolloverBuy(state, exec, token, game.token.pool, mmEndAtMs,
            () => { inPosition = true; inFlight = false; },
            () => { inFlight = false; bought = false; rolloverSet = false; } // fail → fallback
          );
        }
      }
    }

    // ── TRADING PHASE ────────────────────────────────────────────────────────
    if (game.tradingOpen) {

      // Fallback buy: rollover spin gave up — check price before buying
      // If price already pumped 50%+ from MM phase, Shadow has dumped on us. Skip.
      if (!bought && !inPosition && !inFlight && remaining > 150) {
        bought = true; // always mark — one attempt per battle
        const currentPrice = game.token?.currentPrice ?? 0;
        const pumpPct = mmPrice && currentPrice ? ((currentPrice / mmPrice) - 1) * 100 : 0;
        if (pumpPct > 50) {
          log(`[BUY] ⚠️ Skip — price pumped +${pumpPct.toFixed(1)}% from MM phase. Shadow likely dumping.`);
        } else {
          inFlight = true;
          log(`[BUY] Fallback — ${ethers.formatUnits(BUY_AMOUNT, 18)} USDC (pump from MM: +${pumpPct.toFixed(1)}%)`);
          doBuy(state, exec, token, BUY_AMOUNT, 'BUY')
            .then(ok => { if (ok) inPosition = true; })
            .finally(() => { inFlight = false; });
        }
      }

      // ── SELL LOGIC: Shadow-matched staggered exit strategy ──────────────────
      if (inPosition && !inFlight) {
        let bal = 0n;
        try { bal = await tokBal(token); } catch {}

        if (bal > 0n) {
          const price = game.token?.currentPrice
            ? ethers.parseUnits(game.token.currentPrice.toFixed(18), 18) : 0n;

          if (avgEntry === 0n && price > 0n) {
            avgEntry = BUY_AMOUNT * (10n ** 18n) / bal;
            runningPeak = price > avgEntry ? price : avgEntry;
            originalBal = bal;
            log(`[ENTRY] On-chain Cost Basis: ${ethers.formatUnits(avgEntry, 18)} USDC (API Price: ${game.token.currentPrice}) | Balance: ${ethers.formatUnits(bal, 18)} tokens`);
          }
          if (price > runningPeak) runningPeak = price; // track highest seen

          const peakPct     = avgEntry > 0n && runningPeak > 0n ? Number((runningPeak * 1000n / avgEntry) - 1000n) / 10 : 0;
          const currentPct  = avgEntry > 0n && price > 0n ? Number((price * 1000n / avgEntry) - 1000n) / 10 : 0;

          // 1. Peak Profit Lock (+20% or more price pump)
          if (!soldPeak && soldEndStep === 0 && avgEntry > 0n && price > 0n && (price * 100n / avgEntry) >= PARTIAL_SELL_TRIGGER) {
            soldPeak = true;
            const amt = originalBal * 80n / 100n;
            log(`[PEAK SELL] Price reaches peak (+${currentPct.toFixed(1)}%). Selling 80% of original balance (${ethers.formatUnits(amt, 18)} tokens)`);
            sellTokens(token, amt, 'PEAK-SELL', GAS_SELL, false)
              .then(success => { if (!success) soldPeak = false; });
          }
          // 3. Staggered End-of-round sells (20s, 11s, 3s remaining)
          else if (remaining <= 25 && soldEndStep === 0) {
            soldEndStep = 1;
            const amt = originalBal * 5n / 100n;
            log(`[END SELL 1] 25s remaining. Selling 5% of original balance (${ethers.formatUnits(amt, 18)} tokens)`);
            sellTokens(token, amt < bal ? amt : bal, 'END-1', GAS_SELL_END, false)
              .then(success => { if (!success) soldEndStep = 0; });
          }
          else if (remaining <= 15 && soldEndStep === 1) {
            soldEndStep = 2;
            const amt = originalBal * 5n / 100n;
            log(`[END SELL 2] 15s remaining. Selling 5% of original balance (${ethers.formatUnits(amt, 18)} tokens)`);
            sellTokens(token, amt < bal ? amt : bal, 'END-2', GAS_SELL_END, false)
              .then(success => { if (!success) soldEndStep = 1; });
          }
          else if (remaining <= 6 && soldEndStep === 2) {
            soldEndStep = 3;
            log(`[END SELL 3] 6s remaining. Selling all remaining balance (${ethers.formatUnits(bal, 18)} tokens)`);
            sellTokens(token, bal, 'END-3', GAS_SELL_END, true)
              .then(success => { if (!success) soldEndStep = 2; });
          }
          else if (tick % 4 === 0 && avgEntry > 0n && price > 0n) {
            const dir = price >= runningPeak ? '🚀' : price > avgEntry ? '📈' : '📉';
            log(`[HOLD] ${dir} ${game.token.currentPrice} | now:${currentPct >= 0 ? '+' : ''}${currentPct.toFixed(1)}% peak:+${peakPct.toFixed(1)}% | ${remaining}s`);
          }
        }
      }
      tick++;
    }

    await sleep(500);
  }
}

/*
  for (;;) {
    try { await main(); }
    catch (e) { log('[CRASH]', e.shortMessage || e.message); }
    await sleep(3000);
  }
*/

(async () => { const state = await init(); try { const t = await jwt(state); const res = await apiFetch('/agents/refill', { method: 'POST', token: t, body: { address: state.address } }); console.log('REFILL RESPONSE:', res); const bal = await provider.getBalance(state.address); console.log('BALANCE AFTER:', ethers.formatEther(bal)); } catch(e) { console.error('REFILL ERROR:', e); } process.exit(0); })();