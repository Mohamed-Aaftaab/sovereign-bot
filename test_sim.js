import fs from 'fs';
import { ethers } from 'ethers';

const API        = 'https://alpha.creator.bid/api';
const RPC        = 'http://5.161.35.78:8545';
const FACTORY    = '0xE841bCA5A85C76FA667a968C4fe817Ffa2E220e7';
const TRADER_ZH  = '0x521FAcaAB630E30614617c9ae5f6508cB4213540';
const ROLE_KEY   = '0xfacaf2747a7486cf5730e9265973fb54447d3ace6e7e4711f6360826b0731941';
const USDC_ADDR  = '0xed38c197b319fdc067f4c3fb58eec1a733a36cf4';
const STATE_FILE = '.agent.json';

const provider = new ethers.JsonRpcProvider(RPC, 42069, { staticNetwork: true });

async function apiFetch(path, { method = 'GET', token, body } = {}) {
  const h = { 'Content-Type': 'application/json' };
  if (token) h.Authorization = 'Bearer ' + token;
  const r = await fetch(API + path, { method, headers: h, body: body ? JSON.stringify(body) : undefined });
  const txt = await r.text();
  let d; try { d = JSON.parse(txt); } catch { d = { _raw: txt }; }
  if (!r.ok) { throw new Error(`${path} ${r.status}: ${d.error || txt}`); }
  return d;
}

const TRADER_ABI = [
  'function tradeViaFactory(address factory,(bytes signature,bytes data,uint256 expiresAt,uint256 nonce) signature,(uint160 sqrtPriceLimit,uint256 minAmountOut) tradeLimits,uint256 ethValue) external',
  'function approveFactory(address token, uint256 amount) external',
];
const ROLES_ABI = ['function execTransactionWithRole(address to,uint256 value,bytes data,uint8 operation,bytes32 roleKey,bool shouldRevert) returns (bool)'];
const iface = new ethers.Interface(TRADER_ABI);
const rolesIface = new ethers.Interface(ROLES_ABI);

async function main() {
  const state = JSON.parse(fs.readFileSync(STATE_FILE, 'utf8'));
  const wallet = new ethers.Wallet(state.pk, provider);

  console.log("Wallet address:", wallet.address);
  console.log("Roles Modifier:", state.rolesMod);
  console.log("Trading Safe:", state.tradingSafe);

  // Get active game
  const game = await apiFetch('/game');
  console.log("Active Game token symbol:", game.token?.symbol, "Address:", game.token?.address);
  if (!game.token?.address) {
    console.log("No active game token.");
    return;
  }
  const token = game.token.address;

  // Let's get a swap signature
  console.log("Requesting signature...");
  const sig = await apiFetch('/skill/swap', {
    method: 'POST',
    token: state.agentJwt,
    body: { tokenAddress: token, amountIn: (100n * 10n ** 18n).toString(), isBuy: true }
  });
  console.log("Signature obtained:", sig);

  // Encode tradeViaFactory call
  const usdcLower = BigInt(USDC_ADDR) < BigInt(token);
  const zeroForOne = usdcLower; // true for buy
  const MIN_SQRT_RATIO = 4295128740n;
  const MAX_SQRT_RATIO = 1461446703485210103287273052203988822378723970341n;
  const limit = zeroForOne ? MIN_SQRT_RATIO : MAX_SQRT_RATIO;

  const data = iface.encodeFunctionData('tradeViaFactory', [
    FACTORY,
    { signature: sig.signature, data: sig.data, expiresAt: BigInt(sig.expiresAt), nonce: BigInt(sig.nonce) },
    { sqrtPriceLimit: limit, minAmountOut: 0n },
    0n,
  ]);

  const txData = rolesIface.encodeFunctionData('execTransactionWithRole', [
    TRADER_ZH, 0n, data, 1, ROLE_KEY, true
  ]);

  const txRequest = {
    from: wallet.address,
    to: state.rolesMod,
    data: txData,
    gasLimit: 420000n
  };

  const directTxRequest = {
    from: state.tradingSafe,
    to: TRADER_ZH,
    data: data,
    gasLimit: 420000n
  };

  console.log("Simulating provider.call via Roles Modifier...");
  try {
    const res = await provider.call(txRequest);
    console.log("Simulation succeeded! Return value:", res);
  } catch (err) {
    console.error("Simulation failed! Detailing error properties:");
    console.error("Message:", err.message);
    console.error("Raw revert hex (err.data):", err.data || err.error?.data);
  }

  console.log("\nSimulating DIRECT call from Safe (bypassing Roles Modifier)...");
  try {
    const res = await provider.call(directTxRequest);
    console.log("Direct Simulation succeeded! Return value:", res);
  } catch (err) {
    console.error("Direct Simulation failed!");
    console.error("Message:", err.message);
    console.error("Short Message:", err.shortMessage);
    const errData = err.data || err.error?.data;
    console.error("Raw revert hex:", errData);
    if (errData) {
      // Decode typical errors or print signature
      console.log("Error signature:", errData.slice(0, 10));
    }
  }
}

main().catch(console.error);
