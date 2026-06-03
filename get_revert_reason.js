import { ethers } from 'ethers';

const p = new ethers.JsonRpcProvider('http://5.161.35.78:8545', 42069, { staticNetwork: true });

// Try to use debug_traceTransaction if available
async function traceTransaction(txHash) {
  console.log(`\nTracing: ${txHash.slice(0,20)}...`);
  try {
    const trace = await p.send('debug_traceTransaction', [txHash, {
      tracer: 'callTracer',
      tracerConfig: { withLog: false }
    }]);
    // Find the deepest revert
    function findReverts(call, depth = 0) {
      const indent = '  '.repeat(depth);
      if (call.error) {
        console.log(`${indent}[${call.type}] ${call.to} REVERTS: ${call.error}`);
        if (call.output) console.log(`${indent}  Output: ${call.output.slice(0,66)}`);
      }
      if (call.calls) call.calls.forEach(c => findReverts(c, depth + 1));
    }
    console.log('Full trace (calls that revert):');
    findReverts(trace);
    
    // Also print full trace up to 3 levels deep
    function printTrace(call, depth = 0) {
      const indent = '  '.repeat(depth);
      const to = call.to?.slice(0, 18) || '(null)';
      const status = call.error ? `❌ ${call.error}` : '✅';
      console.log(`${indent}[${call.type}] ${to} ${status}`);
      if (call.output && call.error) console.log(`${indent}  Output: ${call.output.slice(0, 100)}`);
      if (call.calls && depth < 4) call.calls.forEach(c => printTrace(c, depth + 1));
    }
    console.log('\nFull call trace:');
    printTrace(trace);
  } catch (e) {
    console.log('debug_traceTransaction failed:', e.message.slice(0, 100));
    // Fall back to replaying at block-1
    const tx = await p.getTransaction(txHash);
    const receipt = await p.getTransactionReceipt(txHash);
    try {
      await p.call({ from: tx.from, to: tx.to, data: tx.data, value: tx.value }, receipt.blockNumber - 1);
    } catch (ce) {
      const data = ce.data || ce.error?.data || '';
      console.log('Replay error:', ce.shortMessage || ce.message);
      if (data) console.log('Error data:', data, '=> selector:', data.slice(0,10));
    }
  }
}

await traceTransaction('0x1c84cbffd53c725903f005e6a51ca5bdbac9e80c20aa409b0031f5e480321335');
