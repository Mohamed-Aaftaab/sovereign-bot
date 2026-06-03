import { ethers } from 'ethers';

const SIGNER_ADDR = '0x40bd61676fd2aa444E7f81d21c9B4c28d6B84DD1'.toLowerCase();

const factory = '0xE841bCA5A85C76FA667a968C4fe817Ffa2E220e7';
const signature = '0x66e501cd951657f6b0a623d9b1eaa3d85709f2ae8a0365f75977706f0a52c6b436d41805bb5d40524f02590e4eb87f286d35af891b7fc4746c4a1bacce03236f1c';
const expiresAt = 1780300931n;
const nonce = 1780259455851n;
const data = '0x000000000000000000000000f76667313d19cfca9a59096a2edf5eb1ff1ef0f300000000000000000000000000000000000000000000001d460162f516f00000000000000000000000000000000000000000000000000000000000000000000100000000000000000000000000000000000000000000000000000000000000800000000000000000000000000000000000000000000000000000000000000000';

function tryRecover(hash, desc) {
  try {
    const recovered = ethers.recoverAddress(hash, signature).toLowerCase();
    if (recovered === SIGNER_ADDR) {
      console.log(`\n🎉 SUCCESS [${desc}]: recovered expected signer ${recovered}`);
      return true;
    }
  } catch (e) {
    // console.log(`Error recovering ${desc}:`, e.message);
  }
  return false;
}

function main() {
  // Test 1: Simple abi.encode packed / raw keccak256
  // Hash format: factory + data + expiresAt + nonce
  console.log("Testing simple hashes...");
  
  // Standard abi.encode
  const hash1 = ethers.keccak256(
    ethers.AbiCoder.defaultAbiCoder().encode(
      ['address', 'bytes', 'uint256', 'uint256'],
      [factory, data, expiresAt, nonce]
    )
  );
  tryRecover(hash1, "abi.encode(factory, data, expiresAt, nonce) Raw");
  tryRecover(ethers.hashMessage(ethers.getBytes(hash1)), "abi.encode(factory, data, expiresAt, nonce) EthSigned");

  // Try different order of arguments
  const hash2 = ethers.keccak256(
    ethers.AbiCoder.defaultAbiCoder().encode(
      ['bytes', 'address', 'uint256', 'uint256'],
      [data, factory, expiresAt, nonce]
    )
  );
  tryRecover(hash2, "abi.encode(data, factory, expiresAt, nonce) Raw");
  tryRecover(ethers.hashMessage(ethers.getBytes(hash2)), "abi.encode(data, factory, expiresAt, nonce) EthSigned");

  // Standard abi.encodePacked
  const hash3 = ethers.solidityPackedKeccak256(
    ['address', 'bytes', 'uint256', 'uint256'],
    [factory, data, expiresAt, nonce]
  );
  tryRecover(hash3, "abi.encodePacked(factory, data, expiresAt, nonce) Raw");
  tryRecover(ethers.hashMessage(ethers.getBytes(hash3)), "abi.encodePacked(factory, data, expiresAt, nonce) EthSigned");

  // Test 2: EIP-712
  console.log("\nTesting EIP-712...");
  const types = {
    SwapSignature: [
      { name: 'data', type: 'bytes' },
      { name: 'expiresAt', type: 'uint256' },
      { name: 'nonce', type: 'uint256' }
    ]
  };
  const value = {
    data,
    expiresAt,
    nonce
  };
  
  // Try various domain name/versions
  const names = ['CreatorBid', 'Creator.bid', 'CreatorBidSwap', 'Factory', 'TRADER_ZH', 'Trader'];
  const versions = ['1', '1.0', '2', '2.0'];
  const chainIds = [42069, 1]; // testnet chainId or ethereum mainnet
  
  for (const name of names) {
    for (const version of versions) {
      for (const chainId of chainIds) {
        try {
          const domain = {
            name,
            version,
            chainId,
            verifyingContract: factory
          };
          const hash = ethers.TypedDataEncoder.hash(domain, types, value);
          if (tryRecover(hash, `EIP712 name=${name} version=${version} chainId=${chainId} verContract=factory`)) return;
        } catch {}
      }
    }
  }
}

main();
