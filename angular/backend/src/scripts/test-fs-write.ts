import * as fs from 'fs';
import * as path from 'path';

const CWD = process.cwd();
const logsDir = path.join(CWD, 'logs');
const testFilePath = path.join(logsDir, 'filesystem-test.log');

console.log(`[FS Test] Current process.cwd(): ${CWD}`);
console.log(`[FS Test] Attempting to write to: ${testFilePath}`);

try {
  if (!fs.existsSync(logsDir)) {
    console.log(`[FS Test] Logs directory does not exist, attempting to create: ${logsDir}`);
    fs.mkdirSync(logsDir, { recursive: true });
    console.log(`[FS Test] Logs directory creation attempt finished.`);
  } else {
    console.log(`[FS Test] Logs directory already exists: ${logsDir}`);
  }

  const content = `[${new Date().toISOString()}] Filesystem test content.\n`;
  fs.writeFileSync(testFilePath, content, { flag: 'a' }); // 'a' for append

  console.log(`[FS Test] Successfully wrote to ${testFilePath}. Checking content...`);

  const writtenContent = fs.readFileSync(testFilePath, 'utf-8');
  if (writtenContent.includes('Filesystem test content')) {
    console.log(`[FS Test] Content verification successful! File content:\n${writtenContent}`);
  } else {
    console.error(`[FS Test] Content verification FAILED. File exists but content is unexpected or empty. Read: ${writtenContent}`);
  }

} catch (error) {
  console.error(`[FS Test] Error during filesystem test:`, error);
} 