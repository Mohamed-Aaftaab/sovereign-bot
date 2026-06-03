import fs from 'fs';
import path from 'path';

const scratchDir = 'C:\\Users\\Mohamed Aaftaab\\.gemini\\antigravity\\brain\\b60e42ea-8ee0-44d7-b844-bffff55b7973\\scratch';
const files = fs.readdirSync(scratchDir);

for (const file of files) {
  if (file.endsWith('.js') || file.endsWith('.py') || file.endsWith('.txt')) {
    const content = fs.readFileSync(path.join(scratchDir, file), 'utf8');
    if (content.includes('swap') || content.includes('signature')) {
      console.log(`Found in file: ${file}`);
      // Find lines containing swap or signature
      const lines = content.split('\n');
      for (let i = 0; i < lines.length; i++) {
        if (lines[i].includes('swap') || lines[i].includes('signature')) {
          console.log(`  L${i+1}: ${lines[i].trim()}`);
        }
      }
    }
  }
}
