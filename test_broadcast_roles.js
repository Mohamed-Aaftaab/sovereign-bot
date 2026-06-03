import { ethers } from 'ethers';

const RPC = 'http://5.161.35.78:8545';
const provider = new ethers.JsonRpcProvider(RPC, 42069, { staticNetwork: true });

const pk = '0xe29653ddb6ba4ac0af133a11216bd1972d5b50879eed816b9be2d083978c40b8';
const wallet = new ethers.Wallet(pk, provider);

const ROLES_ABI = [
  'function execTransactionWithRole(address to,uint256 value,bytes data,uint8 operation,bytes32 roleKey,bool shouldRevert) returns (bool)'
];
const TRADER_ABI = [
  'function tradeViaFactory(address factory,(bytes signature,bytes data,uint256 expiresAt,uint256 nonce) signature,(uint160 sqrtPriceLimit,uint256 minAmountOut) tradeLimits,uint256 ethValue) external'
];

const rolesIface = new ethers.Interface(ROLES_ABI);
const traderIface = new ethers.Interface(TRADER_ABI);

const TRADER_ZH = '0x521FAcaAB630E30614617c9ae5f6508cB4213540';
const ROLE_KEY = '0xfacaf2747a7486cf5730e9265973fb54447d3ace6e7e4711f6360826b0731941';

async function main() {
  const game = await fetch('https://alpha.creator.bid/api/game').then(r => r.json());
  if (!game.active || !game.token) {
    console.log("No active game to test swap.");
    return;
  }
  const token = game.token.address;
  console.log(`Testing active token: ${game.token.symbol} (${token})`);

  const amount = 100n * 10n ** 18n; // 100 USDC
  const state = { agentJwt: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIweGZiOWMxYmNhZDAyOWRiOGVmNGZhOTU2NTc2MDg4ODkyNmRlNjUwNjgiLCJ0cmFkaW5nU2FmZSI6IjB4NDQzMTZkNmNDMTQxQjE1Q0I5NTdkQ2U4MWZhZjJCNTA5NEY5RmZhMCIsInRyZWFzdXJ5U2FmZSI6IjB4NDBjYURGZEJiQkE1RDI2YzYzYWQ3QWUxREMwZjJkOENGMGM3RkQxOCIsImlhdCI6MTc4MDIyNTMyNywiZXhwIjoxNzgwMzExNzI3fQ.xtUjGqBXg1EVE5cSzuUvAO7GTmpzQuR_p7iMUkTIE3k' }; // cached jwt
  
  console.log("Fetching swap signature from API...");
  const sig = await fetch(`https://alpha.creator.bid/api/skill/swap`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': 'Bearer ' + state.agentJwt
    },
    body: JSON.stringify({ tokenAddress: token, amountIn: amount.toString(), isBuy: true })
  }).then(r => r.json());

  console.log("Sig received:", sig);
  if (!sig || !sig.data) {
    console.log("Could not get a valid signature from API.");
    return;
  }

  const usdcLower = BigInt('0xed38c197b319fdc067f4c3fb58eec1a733a36cf4') < BigInt(token);
  const zeroForOne = usdcLower ? true : false;
  const MIN_SQRT_RATIO = 4295128740n;
  const MAX_SQRT_RATIO = 1461446703485210103287273052203988822378723970341n;
  const limit = zeroForOne ? MIN_SQRT_RATIO : MAX_SQRT_RATIO;

  const data = traderIface.encodeFunctionData('tradeViaFactory', [
    '0xE841bCA5A85C76FA667a968C4fe817Ffa2E220e7', // FACTORY
    { signature: sig.signature, data: sig.data, expiresAt: BigInt(sig.expiresAt), nonce: BigInt(sig.nonce) },
    { sqrtPriceLimit: limit, minAmountOut: 0n },
    0n,
  ]);

  const txData = rolesIface.encodeFunctionData('execTransactionWithRole', [
    TRADER_ZH, 0n, data, 1, ROLE_KEY, true
  ]);

  const nonce = await provider.getTransactionCount(wallet.address);
  const txRequest = {
    to: '0x1c1ccad833339e6e67801965cc032d01aeefdb22', // rolesMod address
    data: txData,
    gasLimit: 450000n,
    nonce: nonce,
    chainId: 42069,
    gasPrice: ethers.parseUnits('3500.0', 'gwei')
  };

  try {
    console.log("Signing roles transaction...");
    const signed = await wallet.signTransaction(txRequest);
    console.log("Broadcasting roles transaction...");
    const tx = await provider.broadcastTransaction(signed);
    console.log("Tx sent! Hash:", tx.hash);
    const rec = await tx.wait();
    console.log("Mined! Status:", rec.status);
  } catch (e) {
    console.error("Broadcast failed:", e);
  }
}

main().catch(console.error);
