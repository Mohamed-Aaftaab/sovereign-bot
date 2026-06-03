import { ethers } from 'ethers';

const SIGNER_ADDR = '0x40bd61676fd2aa444E7f81d21c9B4c28d6B84DD1'.toLowerCase();

const factory = '0xE841bCA5A85C76FA667a968C4fe817Ffa2E220e7';
const signature = '0x66e501cd951657f6b0a623d9b1eaa3d85709f2ae8a0365f75977706f0a52c6b436d41805bb5d40524f02590e4eb87f286d35af891b7fc4746c4a1bacce03236f1c';
const expiresAt = 1780300931n;
const nonce = 1780259455851n;
const data = '0x000000000000000000000000f76667313d19cfca9a59096a2edf5eb1ff1ef0f300000000000000000000000000000000000000000000001d460162f516f00000000000000000000000000000000000000000000000000000000000000000000100000000000000000000000000000000000000000000000000000000000000800000000000000000000000000000000000000000000000000000000000000000';

const shadowSafe = '0xb0b9dfc8b5bbff00df94e67993aadf458ab92040';
const shadowEOA = '0x541bb659df7daff414388118053f06e4c091801b';
const trader = '0x521FAcaAB630E30614617c9ae5f6508cB4213540';

function tryRecover(hash, desc) {
  try {
    const recovered = ethers.recoverAddress(hash, signature).toLowerCase();
    if (recovered === SIGNER_ADDR) {
      console.log(`\n🎉 SUCCESS [${desc}]: recovered expected signer ${recovered}`);
      process.exit(0);
    }
  } catch (e) {}
}

function getPermutations(array) {
  const result = [];
  const permute = (arr, m = []) => {
    if (arr.length === 0) {
      result.push(m);
    } else {
      for (let i = 0; i < arr.length; i++) {
        let curr = arr.slice();
        let next = curr.splice(i, 1);
        permute(curr.slice(), m.concat(next));
      }
    }
  }
  permute(array);
  return result;
}

function main() {
  console.log("Brute-forcing permutations of hash data...");

  // We want to test different combinations of these variables:
  const items = [
    { name: 'factory', type: 'address', value: factory },
    { name: 'trader', type: 'address', value: trader },
    { name: 'safe', type: 'address', value: shadowSafe },
    { name: 'eoa', type: 'address', value: shadowEOA },
    { name: 'data', type: 'bytes', value: data },
    { name: 'expiresAt', type: 'uint256', value: expiresAt },
    { name: 'nonce', type: 'uint256', value: nonce }
  ];

  // Try all subsets of size 2 to items.length
  for (let len = 2; len <= items.length; len++) {
    // Generate subsets of size `len`
    const subsets = [];
    const getSubsets = (start, arr) => {
      if (arr.length === len) {
        subsets.push(arr);
        return;
      }
      for (let i = start; i < items.length; i++) {
        getSubsets(i + 1, arr.concat([items[i]]));
      }
    };
    getSubsets(0, []);

    for (const subset of subsets) {
      // Get all permutations of this subset
      const perms = getPermutations(subset);
      for (const perm of perms) {
        const types = perm.map(x => x.type);
        const values = perm.map(x => x.value);
        const desc = perm.map(x => x.name).join(', ');

        // Test standard encode
        try {
          const hashRaw = ethers.keccak256(ethers.AbiCoder.defaultAbiCoder().encode(types, values));
          tryRecover(hashRaw, `abi.encode(${desc}) Raw`);
          tryRecover(ethers.hashMessage(ethers.getBytes(hashRaw)), `abi.encode(${desc}) EthSigned`);
        } catch {}

        // Test packed encode
        try {
          const hashPacked = ethers.solidityPackedKeccak256(types, values);
          tryRecover(hashPacked, `abi.encodePacked(${desc}) Raw`);
          tryRecover(ethers.hashMessage(ethers.getBytes(hashPacked)), `abi.encodePacked(${desc}) EthSigned`);
        } catch {}
      }
    }
  }

  // Also test EIP712 domains with TRADER_ZH
  console.log("Testing EIP712 with verifyingContract=trader...");
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
  
  const names = ['CreatorBid', 'Creator.bid', 'CreatorBidSwap', 'Factory', 'TRADER_ZH', 'Trader', 'TraderHelper', 'TraderZeroHelper'];
  const versions = ['1', '1.0', '2', '2.0'];
  const chainIds = [42069, 1];
  
  for (const name of names) {
    for (const version of versions) {
      for (const chainId of chainIds) {
        for (const contract of [factory, trader, shadowSafe]) {
          try {
            const domain = {
              name,
              version,
              chainId,
              verifyingContract: contract
            };
            const hash = ethers.TypedDataEncoder.hash(domain, types, value);
            tryRecover(hash, `EIP712 name=${name} version=${version} chainId=${chainId} verContract=${contract === factory ? 'factory' : contract === trader ? 'trader' : 'safe'}`);
          } catch {}
        }
      }
    }
  }

  console.log("No combinations matched.");
}

main();
