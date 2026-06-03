import fs from 'fs';

const STATE_FILE = '.agent.json';
const API = 'https://alpha.creator.bid/api';

async function check() {
  try {
    const s = JSON.parse(fs.readFileSync(STATE_FILE, 'utf8'));
    const r = await fetch(API + '/dashboard');
    const d = await r.json();

    const shadow = d.agents?.find(x => x.name?.toLowerCase().includes('shadow') || x.address?.toLowerCase() === '0x541bb659df7daff414388118053f06e4c091801b');
    console.log("Shadow details:");
    console.log(JSON.stringify(shadow, null, 2));

    const me = d.agents?.find(x => x.address?.toLowerCase() === s.address?.toLowerCase());
    console.log("My details:");
    console.log(JSON.stringify(me, null, 2));
  } catch (e) {
    console.error(e);
  }
}
check();
