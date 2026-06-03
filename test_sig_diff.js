import fs from 'fs';

const STATE_FILE = '.agent.json';
const API = 'https://alpha.creator.bid/api';

async function apiFetch(path, { method = 'GET', token, body } = {}) {
  const h = { 'Content-Type': 'application/json' };
  if (token) h.Authorization = 'Bearer ' + token;
  const r = await fetch(API + path, { method, headers: h, body: body ? JSON.stringify(body) : undefined });
  return r.json();
}

async function main() {
  try {
    const state = JSON.parse(fs.readFileSync(STATE_FILE, 'utf8'));
    const game = await apiFetch('/game');
    if (!game.active || !game.token) {
      console.log("No active game.");
      return;
    }
    const token = game.token.address;
    console.log(`Active token: ${game.token.symbol} (${token})`);

    const amount = 100n * 10n ** 18n;
    console.log("Requesting signature...");
    const sig = await apiFetch('/skill/swap', {
      method: 'POST',
      token: state.agentJwt,
      body: { tokenAddress: token, amountIn: amount.toString(), isBuy: true }
    });

    console.log("Signature response:", JSON.stringify(sig, null, 2));
  } catch (e) {
    console.error(e);
  }
}
main();
