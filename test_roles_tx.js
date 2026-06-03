import { ethers } from 'ethers';

const RPC = 'http://5.161.35.78:8545';
const provider = new ethers.JsonRpcProvider(RPC, 42069, { staticNetwork: true });

const pk = '0xe29653ddb6ba4ac0af133a11216bd1972d5b50879eed816b9be2d083978c40b8';
const wallet = new ethers.Wallet(pk, provider);

const ROLES_ABI = [
  'function execTransactionWithRole(address to,uint256 value,bytes data,uint8 operation,bytes32 roleKey,bool shouldRevert) returns (bool)'
];
const rolesIface = new ethers.Interface(ROLES_ABI);

const TRADER_ZH = '0x521FAcaAB630E30614617c9ae5f6508cB4213540';
const ROLE_KEY = '0xfacaf2747a7486cf5730e9265973fb54447d3ace6e7e4711f6360826b0731941';

async function main() {
  const nonce = await provider.getTransactionCount(wallet.address);
  const data = '0x'; // dummy data
  
  const txData = rolesIface.encodeFunctionData('execTransactionWithRole', [
    TRADER_ZH, 0n, data, 1, ROLE_KEY, true
  ]);

  const txRequest = {
    to: '0x1c1ccad833339e6e67801965cc032d01aeefdb22', // rolesMod address
    data: txData,
    gasLimit: 450000n,
    nonce: nonce,
    chainId: 42069,
    gasPrice: ethers.parseUnits('3500.0', 'gwei')
  };

  try {
    console.log("Signing raw roles transaction...");
    const signedTx = await wallet.signTransaction(txRequest);
    console.log("Signing success! Length:", signedTx.length);
  } catch (e) {
    console.error("Sign error:", e);
  }
}

main().catch(console.error);
