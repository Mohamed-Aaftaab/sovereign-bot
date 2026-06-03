import fs from 'fs';

const STATE_FILE = '.agent.json';
const API = 'https://alpha.creator.bid/api';
const OUT_FILE = 'sig_phases.txt';

async function apiFetch(path, { method = 'GET', token, body } = {}) {
  const h = { 'Content-Type': 'application/json' };
  if (token) h.Authorization = 'Bearer ' + token;
  const r = await fetch(API + path, { method, headers: h, body: body ? JSON.stringify(body) : undefined });
  const status = r.status;
  const text = await r.text();
  let data; try { data = JSON.parse(text); } catch { data = { raw: text }; }
  return { status, data };
}

async function main() {
  try {
    const state = JSON.parse(fs.readFileSync(STATE_FILE, 'utf8'));
    fs.writeFileSync(OUT_FILE, '=== API Sig Phase Monitor ===\n');

    console.log("Monitoring API signature phases for 90 seconds. Writing output to sig_phases.txt...");

    for (let i = 0; i < 90; i++) {
      const game = await apiFetch('/game');
      const token = game.data?.token?.address;
      const status = game.data?.status;
      const remaining = game.data?.lobbyRemaining ?? game.data?.mmRemaining ?? game.data?.gameRemaining ?? 0;

      let sigRes = null;
      if (token) {
        const amount = 100n * 10n ** 18n;
        sigRes = await apiFetch('/skill/swap', {
          method: 'POST',
          token: state.agentJwt,
          body: { tokenAddress: token, amountIn: amount.toString(), isBuy: true }
        });
      }

      const logLine = `[${new Date().toISOString().slice(14, 21)}] Game Status: ${status} (${remaining}s remaining) | Token: ${token?.slice(0, 10)} | API Status: ${sigRes?.status} | Sig: ${sigRes ? JSON.stringify(sigRes.data).slice(0, 150) : 'N/A'}\n`;
      fs.appendFileSync(OUT_FILE, logLine);
      console.log(logLine.trim());

      await new Promise(r => setTimeout(r, 1000));
    }
    fs.appendFileSync(OUT_FILE, '=== Monitor Complete ===\n');
  } catch (e) {
    fs.appendFileSync(OUT_FILE, `ERROR: ${e.message}\n`);
  }
}
main();
