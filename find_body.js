import fs from 'fs';
import path from 'path';

const scratchDir = 'C:\\Users\\Mohamed Aaftaab\\.gemini\\antigravity\\brain\\b60e42ea-8ee0-44d7-b844-bffff55b7973\\scratch';
const files = fs.readdirSync(scratchDir);

for (const file of files) {
  if (file.endsWith('.js') || file.endsWith('.py') || file.endsWith('.txt')) {
    const content = fs.readFileSync(path.join(scratchDir, file), 'utf8');
    if (content.includes('/skill/swap')) {
      console.log(`Found /skill/swap in: ${file}`);
      const lines = content.split('\n');
      for (let i = 0; i < lines.length; i++) {
        if (lines[i].includes('/skill/swap')) {
          console.log(`  Lines ${i-2} to ${i+6}:`);
          for (let j = Math.max(0, i-2); j < Math.min(lines.length, i+6); j++) {
            console.log(`    ${j+1}: ${lines[j].trim()}`);
          }
        }
      }
    }
  }
}
