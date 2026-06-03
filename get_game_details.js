import fs from 'fs';

const API = 'https://alpha.creator.bid/api';

async function apiFetch(path) {
  const r = await fetch(API + path);
  return r.json();
}

async function main() {
  const game = await apiFetch('/game');
  console.log("Active Game details:", JSON.stringify(game, null, 2));
}

main().catch(console.error);
