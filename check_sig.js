import fs from 'fs';
import { ethers } from 'ethers';

const STATE_FILE = '.agent.json';
const RPC = 'http://5.161.35.78:8545';
const API = 'https://alpha.creator.bid/api';
const FACTORY = '0xE841bCA5A85C76FA667a968C4fe817Ffa2E220e7';
const TRADER_ZH  = '0x521FAcaAB630E30614617c9ae5f6508cB4213540';
const ROLE_KEY   = '0xfacaf2747a7486cf5730e9265973fb54447d3ace6e7e4711f6360826b0731941';

async function apiFetch(path, { method = 'GET', token, body } = {}) {
  const h = { 'Content-Type': 'application/json' };
  if (token) h.Authorization = 'Bearer ' + token;
  const r = await fetch(API + path, { method, headers: h, body: body ? JSON.stringify(body) : undefined });
  const txt = await r.text();
  let d; try { d = JSON.parse(txt); } catch { d = { _raw: txt }; }
  return d;
}

async function main() {
  const provider = new ethers.JsonRpcProvider(RPC, 42069, { staticNetwork: true });
  const state = JSON.parse(fs.readFileSync(STATE_FILE, 'utf8'));

  const game = await apiFetch('/game');
  console.log("Full game state:", JSON.stringify(game, null, 2));
  if (!game.active || !game.token) {
    console.log("No active game.");
    return;
  }
  const token = game.token.address;
  console.log(`Active token: ${game.token.symbol} (${token})`);

  const amount = 100n * 10n ** 18n;
  const sig = await apiFetch('/skill/swap', {
    method: 'POST',
    token: state.agentJwt,
    body: { tokenAddress: token, amountIn: amount.toString(), isBuy: true }
  });

  console.log("Signature response:", sig);

  if (sig && sig.data) {
    try {
      const decoded = ethers.AbiCoder.defaultAbiCoder().decode(
        ['address', 'uint256', 'bool', 'bytes'], sig.data
      );
      const path = decoded[3];
      console.log(`Decoded path length: ${path.length} bytes`);
      console.log(`Path: ${path}`);
    } catch (e) {
      console.error("Failed to decode path:", e.message);
    }
  }
}

main();
