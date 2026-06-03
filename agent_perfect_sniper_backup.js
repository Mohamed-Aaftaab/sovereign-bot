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
let BUY_AMOUNT      = 50n * 10n ** 18n; // 50 USDC to reduce slippage on entries and exits
// Shadow strategy: BUY at rollover → SELL 20% at first pump peak → HOLD rest to end of round
// Phase 1: sell 20% when price hits +20% (lock in peak profit like Shadow's first fill)
// Phase 2: sell remaining 80% at end of round in 3 staggered steps
// Emergency: hard-stop at -25% (catastrophic crash only)
const TRAIL_STOP_PCT         = 50n;  // last resort only (need 50%+ drop from a 100%+ peak)
const MIN_PEAK_PCT           = 200n; // last resort only (need price to double)
const HARD_STOP_PCT          = 75n;  // emergency stop at -25% from entry
const PARTIAL_SELL_TRIGGER   = 115n; // sell 80% when price reaches +15% above entry
const API_LATENCY_MS         = 0; // Removed 60s pre-fetch to prevent API rate-limiting

const GAS_BUY                = 200n * 10n ** 9n;   // 200 Gwei (Tick 0)
const GAS_SELL               = 1n * 10n ** 9n;     // 1 Gwei (Post-Tick 0)
const GAS_SELL_END           = 1n * 10n ** 9n;     // 1 Gwei (End dump)
const GAS_DIP                = 1n * 10n ** 9n;     // 1 Gwei (Dip buy)

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
  const r = await fetch(API + path, { method, headers: h, body: body ? JSON.stringify(body) : undefined, signal: AbortSignal.timeout(5000) });
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
        gasLimit: customLimit ? customLimit : 445000n,
        nonce: nonceToUse,
        chainId: 42069,
        ...(gasPrice ? { gasPrice } : {})
      };

      // NOTE: No pre-broadcast simulation. provider.call() cannot replicate the
      // on-chain context needed to validate platform signatures (DelegateCall state
      // divergence). We rely on on-chain validation and receipt status instead.

        try {
          const signedTx = await wallet.signTransaction(txRequest);
          const tx = await provider.broadcastTransaction(signedTx);
          
          // Increment nonce immediately after successful broadcast
          if (forcedNonce === undefined || forcedNonce === null) {
            localNonce++;
          }

          const receipt = await tx.wait();
          if (receipt && receipt.status === 0) {
            log(`[EXEC] ❌ Tx reverted on-chain (hash: ${tx.hash.slice(0, 18)})`);
            throw new Error(`Transaction reverted on-chain: ${tx.hash}`);
          }
          return receipt;
        } catch (e) {
          localNonce = null; // Reset nonce so next tx fetches fresh from node
          throw e;
        }
    });
    chain = p.catch(() => {});
    return p;
  };
  execFn.resetNonce = () => { localNonce = null; };
  return execFn;
}

async function getSig(state, addr, amount, isBuy) {
  const call = t => apiFetch('/skill/swap', {
    method: 'POST', token: t,
    body: { tokenAddress: addr, amountIn: amount.toString(), isBuy },
  });
  try { 
      const sig = await call(await jwt(state));
      // Unconditionally override slippage limits because the API does not provide them.
      // We will prevent MEV sandwich attacks on the exit by massively outbidding Vinod's gas price.
      const MIN_SQRT_RATIO = 4295128740n; // MIN + 1
      const MAX_SQRT_RATIO = 1461446703485210103287273052203988822378723970341n; // MAX - 1
      
      let zeroForOne;
      if (isBuy) {
          zeroForOne = USDC_ADDR.toLowerCase() < addr.toLowerCase();
      } else {
          zeroForOne = addr.toLowerCase() < USDC_ADDR.toLowerCase();
      }
      
      sig.sqrtPriceLimit = zeroForOne ? MIN_SQRT_RATIO : MAX_SQRT_RATIO;
      sig.minAmountOut = 0n;
      return sig;
  }
  catch (e) { if (e.status === 401) return call(await login(state)); throw e; }
}
const sigOk = s => s !== null; // Accept our modified sig

async function execTrade(exec, sig, label, gasPrice, tokenAddress, isBuy, nonce) {
  // Construct the normal payload for tradeViaFactory
  const data = iface.encodeFunctionData('tradeViaFactory', [
    FACTORY,
    { signature: sig.signature, data: sig.data, expiresAt: BigInt(sig.expiresAt), nonce: BigInt(sig.nonce) },
    { sqrtPriceLimit: sig.sqrtPriceLimit, minAmountOut: sig.minAmountOut },
    0n,
  ]);
  const r = await exec(data, gasPrice, nonce, 450000n);
  log(`[${label}] ✅ ${r?.transactionHash?.slice(0, 18)} (gas: ${gasPrice ? ethers.formatUnits(gasPrice, 'gwei') + ' Gwei' : 'default'})`);
  return r;
}

// Buy with 3 attempts, fresh sig each time, high gas for block priority
async function doBuy(state, exec, token, amount, label, gasPrice = GAS_BUY) {
  for (let i = 1; i <= 3; i++) {
    try {
      log(`[${label}] attempt ${i} — ${ethers.formatUnits(amount, 18)} USDC`);
      const sig = await getSig(state, token, amount, true);
      if (!sigOk(sig)) { log(`[${label}] sig invalid`); await sleep(300); continue; }
      await execTrade(exec, sig, label, gasPrice, token, true); // 50 Gwei — beats Shadow's 42.3 Gwei
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
function scheduleRolloverBuy(state, exec, token, poolAddress, mmEndAtMs, onSuccess, onFail, onFatal) {
  const msToOpen = Math.max(0, mmEndAtMs - Date.now());
  log(`[ROLLOVER] Scheduled spin at mmEndAt in ${Math.round(msToOpen)}ms`);

  // PREFETCH 5 seconds before mmEndAt
  let preFetchedSig = null;
  const prefetchDelay = Math.max(0, msToOpen - 5000);
  setTimeout(async () => {
    log(`[ROLLOVER] Pre-fetching signature 5 seconds before rollover...`);
    try {
      preFetchedSig = await getSig(state, token, BUY_AMOUNT, true);
      log(`[ROLLOVER] Successfully pre-fetched signature!`);
    } catch (e) {
      log(`[ROLLOVER] Pre-fetch failed: ${e.message}`);
    }
  }, prefetchDelay);

  setTimeout(async () => {
    log('[ROLLOVER] 🚀 Broadcasting instantly at Tick 0...');
    let attempts = 0;
    let broadcasted = false;
    const startTime = Date.now();

    while (Date.now() - startTime < 120_000) {
      attempts++;
      if (state.currentToken !== token) {
        log(`[ROLLOVER] Token changed. Stopping rollover spin.`);
        return;
      }
      try {
        // If we failed to pre-fetch, fall back to fetching now
        const sig = preFetchedSig || await getSig(state, token, BUY_AMOUNT, true);
        if (sigOk(sig)) {
          if (!broadcasted) {
            broadcasted = true; // Only broadcast once — avoid nonce/gas waste
            const gasLabel = ethers.formatUnits(GAS_BUY, 'gwei') + ' Gwei';
            log(`[ROLLOVER] 🚀 Spinning for pool seed + broadcasting...`);
            log(`[ROLLOVER] ✅ Got signature (attempt ${attempts}, +${Math.round((Date.now()-startTime)/1000)}s) — broadcasting at ${gasLabel}`);
              try {
              await execTrade(exec, sig, 'ROLLOVER', GAS_BUY, token, true, null);
              onSuccess();
              return;
            } catch (e) {
              log(`[ROLLOVER] ❌ Broadcast failed: ${e.message}`);
              // FATAL REVERT! We lost the gas race or something failed.
              // We MUST NOT retry, otherwise we enter a Doom Loop and burn all our ETH!
              // Aborting the battle gracefully to save our funds for the next round.
              broadcasted = true; // prevents onFail
              if (onFatal) onFatal();
              return;
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
  let bought         = false;
  let tradePhase     = 0;
  let originalBal    = 0n;
  let inPosition     = false;
  let inFlight       = false;
  let rolloverSet    = false;
  let avgEntry       = 0n;
  let runningPeak    = 0n;    // highest price seen since entry
  let tick           = 0;

  function newBattle(midBattle) {
    bought       = true; // PROTOCOL OMEGA: Skip Tick 0 entirely to avoid API timeouts
    tradePhase   = 2; // PROTOCOL OMEGA: Start directly at Phase 2 (Waiting for Dip)
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
      exec.resetNonce();

      if (midBattle) { log('[STARTUP] Mid-battle — skip.'); await sleep(2000); continue; }

      // Refill
        try {
          const t = await jwt(state);
          const res = await apiFetch('/agents/refill', { method: 'POST', token: t, body: { address: state.address } });
          log('[REFILL] ✅ RESPONSE: ' + JSON.stringify(res));
        } catch (e) { log('[REFILL] ❌ ERROR: ' + (e.message || e)); }

      // Approve USDC + token for factory
      for (const addr of [USDC_ADDR, token]) {
        try {
          const usdcContract = new ethers.Contract(addr, ERC20_ABI, provider);
          const allowance = await usdcContract.allowance(state.tradingSafe, FACTORY);
          if (allowance > 10n * 10n ** 18n) {
            log(`[APPROVE] Already approved ${addr === USDC_ADDR ? 'USDC' : 'Token'}`);
            continue;
          }
          await exec(iface.encodeFunctionData('approveFactory', [addr, ethers.MaxUint256]), GAS_SELL_END);
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
            () => { inFlight = false; bought = false; rolloverSet = false; }, // fail → fallback
            () => { inFlight = false; bought = true; inPosition = false; }    // fatal → skip battle completely
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

      // ── HFT LOGIC: 5-Phase Dip & Peak Strategy ────────────────────────────────
      if (!inFlight) {
        let bal = 0n;
        try { bal = await tokBal(token); } catch {}
        const price = game.token?.currentPrice ? ethers.parseUnits(game.token.currentPrice.toFixed(18), 18) : 0n;
        // PROTOCOL OMEGA: Always track highest peak so Phase 2 can detect the -35% crash from peak
        if (price > runningPeak) runningPeak = price;

        const currentPct = avgEntry > 0n && price > 0n ? Number((price * 1000n / avgEntry) - 1000n) / 10 : 0;

        if (bal > 0n) {
          if (avgEntry === 0n && price > 0n) {
            avgEntry = BUY_AMOUNT * (10n ** 18n) / bal;
            runningPeak = price > avgEntry ? price : avgEntry;
            originalBal = bal;
            if (tradePhase === 0) tradePhase = 1;
            log(`[ENTRY] Phase ${tradePhase} | Cost Basis: ${ethers.formatUnits(avgEntry, 18)} USDC (API Price: ${game.token.currentPrice}) | Bal: ${ethers.formatUnits(bal, 18)}`);
          }
        }

        const peakPct = avgEntry > 0n && runningPeak > 0n ? Number((runningPeak * 1000n / avgEntry) - 1000n) / 10 : 0;

        // Phase 1 (Holding 1st bag) -> Sell Peak
        if (tradePhase === 1 && bal > 0n && price > 0n && (price * 100n / avgEntry) >= PARTIAL_SELL_TRIGGER) {
          inFlight = true;
          log(`[PEAK SELL 1] Price reaches peak (+${currentPct.toFixed(1)}%). Dumping 100%.`);
          sellTokens(token, bal, 'PEAK-SELL-1', GAS_SELL, true).then(ok => {
            inFlight = false;
            if (ok) { tradePhase = 2; avgEntry = 0n; runningPeak = price; }
          });
        }
        // Phase 1/3/5 (Holding) -> Hard Stop
        else if ((tradePhase === 1 || tradePhase === 3 || tradePhase === 5) && bal > 0n && price > 0n && (price * 100n / avgEntry) <= HARD_STOP_PCT) {
          inFlight = true;
          log(`[HARD STOP] Price crashed -25%. Emergency dump!`);
          sellTokens(token, bal, 'HARD-STOP', GAS_SELL_END, true).then(ok => {
            inFlight = false;
            if (ok) { tradePhase = 5; avgEntry = 0n; } // skip dips, token is dead
          });
        }
        // Phase 2 (Waiting for Dip) -> Buy Dip 1
        else if (tradePhase === 2 && bal === 0n && price > 0n && remaining > 90) {
          // Buy dip if price drops 35% from peak
          if ((price * 100n / runningPeak) <= 65n) {
            inFlight = true;
            log(`[DIP BUY 1] Price crashed 35% from peak! Buying the dip!`);
            doBuy(state, exec, token, BUY_AMOUNT, 'BUY-DIP-1', GAS_DIP).then(ok => {
              inFlight = false;
              if (ok) { tradePhase = 3; avgEntry = 0n; }
            });
          }
        }
        // Phase 3 (Holding 2nd bag) -> Sell Secondary Peak
        else if (tradePhase === 3 && bal > 0n && price > 0n && (price * 100n / avgEntry) >= 115n) {
          inFlight = true;
          log(`[PEAK SELL 2] Secondary pump caught (+${currentPct.toFixed(1)}%). Dumping 100%.`);
          sellTokens(token, bal, 'PEAK-SELL-2', GAS_SELL, true).then(ok => {
            inFlight = false;
            if (ok) { tradePhase = 4; avgEntry = 0n; runningPeak = price; }
          });
        }
        // Phase 4 (Waiting for Dip 2) -> Buy Dip 2
        else if (tradePhase === 4 && bal === 0n && price > 0n && remaining > 90) {
          // Buy dip if price drops 15% from secondary peak
          if ((price * 100n / runningPeak) <= 85n) {
            inFlight = true;
            log(`[DIP BUY 2] Price crashed 15% from secondary peak! Buying!`);
            doBuy(state, exec, token, BUY_AMOUNT, 'BUY-DIP-2', GAS_DIP).then(ok => {
              inFlight = false;
              if (ok) { tradePhase = 5; avgEntry = 0n; }
            });
          }
        }
        // Phase 5 (Holding 3rd bag) -> Sell Tertiary Peak
        else if (tradePhase === 5 && bal > 0n && price > 0n && (price * 100n / avgEntry) >= 115n) {
          inFlight = true;
          log(`[PEAK SELL 3] Tertiary pump caught (+${currentPct.toFixed(1)}%). Dumping 100%.`);
          sellTokens(token, bal, 'PEAK-SELL-3', GAS_SELL, true).then(ok => {
            inFlight = false;
            if (ok) { tradePhase = 6; avgEntry = 0n; runningPeak = price; }
          });
        }
        // End of round dump (Phase 1, 3, or 5 if holding)
        else if (remaining <= 15 && bal > 0n && (tradePhase === 1 || tradePhase === 3 || tradePhase === 5)) {
          inFlight = true;
          log(`[END SELL] 15s remaining. Liquidating balance.`);
          sellTokens(token, bal, 'END-FINAL', GAS_SELL_END, true).then(ok => {
            inFlight = false;
            if (ok) { tradePhase = 6; avgEntry = 0n; }
          });
        }
        // Hold log
        else if (tick % 4 === 0 && price > 0n) {
          if (bal > 0n) {
            const dir = price >= runningPeak ? '🚀' : price > avgEntry ? '📈' : '📉';
            log(`[HOLD Phase ${tradePhase}] ${dir} ${game.token.currentPrice} | now:${currentPct >= 0 ? '+' : ''}${currentPct.toFixed(1)}% peak:+${peakPct.toFixed(1)}% | ${remaining}s`);
          } else if (tradePhase === 2 || tradePhase === 4) {
            const dropFromPeak = runningPeak > 0n ? Number((price * 1000n / runningPeak) - 1000n) / 10 : 0;
            const target = tradePhase === 2 ? -35 : -15;
            log(`[WAITING DIP Phase ${tradePhase}] ${game.token.currentPrice} | drop from peak: ${dropFromPeak.toFixed(1)}% (target ${target}%) | ${remaining}s`);
          }
        }
      }
      tick++;
    }

    await sleep(500);
  }
}

;(async function supervise() {
  for (;;) {
    try { await main(); }
    catch (e) { log('[CRASH]', e.shortMessage || e.message); }
    await sleep(3000);
  }
})();
