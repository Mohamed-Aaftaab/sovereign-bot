import { ethers } from 'ethers';

const RPC = 'http://5.161.35.78:8545';
const provider = new ethers.JsonRpcProvider(RPC);
const hash = process.argv[2] || '0x65ffa3a6d66280137cf5eb195a4d302b1807b50abae8d8e4c38360930554703f';

const TRADER_ABI = [
  'function tradeViaFactory(address factory,(bytes signature,bytes data,uint256 expiresAt,uint256 nonce) signature,(uint160 sqrtPriceLimit,uint256 minAmountOut) tradeLimits,uint256 ethValue) external',
];
const ROLES_ABI = ['function execTransactionWithRole(address to,uint256 value,bytes data,uint8 operation,bytes32 roleKey,bool shouldRevert) returns (bool)'];

async function main() {
  const tx = await provider.getTransaction(hash);
  if (!tx) {
    console.log("Transaction not found");
    return;
  }

  const rolesIface = new ethers.Interface(ROLES_ABI);
  const traderIface = new ethers.Interface(TRADER_ABI);

  console.log("Transaction Hash:", tx.hash);
  console.log("Tx From (EOA):", tx.from);
  console.log("Tx To (RolesModifier):", tx.to);

  // Decode execTransactionWithRole
  const decodedExec = rolesIface.decodeFunctionData('execTransactionWithRole', tx.data);
  console.log("\n--- execTransactionWithRole Decoded ---");
  console.log("To:", decodedExec[0]);
  console.log("Value:", decodedExec[1].toString());
  console.log("Operation:", decodedExec[3].toString() === '1' ? '1 (DelegateCall)' : decodedExec[3].toString() + ' (Call)');
  console.log("Role Key:", decodedExec[4]);
  console.log("Should Revert:", decodedExec[5]);

  const innerData = decodedExec[2];
  
  // Decode tradeViaFactory
  const decodedTrade = traderIface.decodeFunctionData('tradeViaFactory', innerData);
  console.log("\n--- tradeViaFactory Decoded ---");
  console.log("Factory:", decodedTrade[0]);
  
  const signatureStruct = decodedTrade[1];
  console.log("\n--- Signature Struct ---");
  console.log("Signature:", signatureStruct.signature);
  console.log("ExpiresAt:", signatureStruct.expiresAt.toString());
  console.log("Nonce:", signatureStruct.nonce.toString());
  
  const sigData = signatureStruct.data;
  console.log("Raw Sig Data (hex):", sigData);

  // Decode signature.data (address tokenIn, uint256 amountIn, bool zeroForOne, bytes path)
  try {
    const decodedSigData = ethers.AbiCoder.defaultAbiCoder().decode(
      ['address', 'uint256', 'bool', 'bytes'], sigData
    );
    console.log("\n--- Decoded Signature.data ---");
    console.log("TokenIn:", decodedSigData[0]);
    console.log("AmountIn:", decodedSigData[1].toString());
    console.log("ZeroForOne:", decodedSigData[2]);
    console.log("Path:", decodedSigData[3]);
    console.log("Path Length in bytes:", (decodedSigData[3].length - 2) / 2);
  } catch (e) {
    console.log("Failed to decode signature.data:", e.message);
  }
}

main().catch(console.error);
