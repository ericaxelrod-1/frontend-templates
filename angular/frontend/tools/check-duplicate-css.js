/**
 * Duplicate CSS Selector Checker
 * 
 * This tool scans all SCSS files in the project to find duplicate CSS selectors
 * that might cause specificity issues or overrides.
 */

const fs = require('fs');
const path = require('path');
const glob = require('glob');

// Configuration
const SRC_DIR = path.join(__dirname, '..', 'src');
const EXCLUDE_PATTERNS = [
  'node_modules',
  'dist',
  '.git',
  '*.spec.scss'
];

// Log helpers
const logError = (message) => console.error('\x1b[31m%s\x1b[0m', `[ERROR] ${message}`);
const logWarning = (message) => console.warn('\x1b[33m%s\x1b[0m', `[WARNING] ${message}`);
const logSuccess = (message) => console.log('\x1b[32m%s\x1b[0m', `[SUCCESS] ${message}`);
const logInfo = (message) => console.log('\x1b[36m%s\x1b[0m', `[INFO] ${message}`);

// Simple CSS parser to extract selectors from SCSS content
function extractSelectors(content) {
  const selectors = [];
  // Remove comments
  const cleanContent = content
    .replace(/\/\*[\s\S]*?\*\//g, '') // Remove multi-line comments
    .replace(/\/\/.*$/gm, '');        // Remove single-line comments
  
  // Extract rule blocks but skip @media, @keyframes, etc.
  const blocks = cleanContent.match(/[^{}]+\{[^{}]*\}/g) || [];
  
  for (const block of blocks) {
    // Extract selector part (before the curly brace)
    const selectorPart = block.split('{')[0].trim();
    
    // Skip @-rules and mixins
    if (selectorPart.startsWith('@') || selectorPart.startsWith('%')) continue;
    
    // Split multiple selectors (e.g., ".class1, .class2")
    const individualSelectors = selectorPart.split(',').map(s => s.trim());
    selectors.push(...individualSelectors);
  }
  
  return selectors;
}

async function checkDuplicateCss() {
  logInfo('Starting duplicate CSS selector check...');
  
  // Find all SCSS files
  const scssFiles = glob.sync('**/*.scss', {
    cwd: SRC_DIR,
    absolute: true,
    ignore: EXCLUDE_PATTERNS
  });
  
  if (scssFiles.length === 0) {
    logWarning('No SCSS files found in the project.');
    return 0;
  }
  
  logInfo(`Found ${scssFiles.length} SCSS files to check.`);
  
  // Map to keep track of all selectors and their files
  const selectorMap = new Map();
  
  // Process each file
  for (const file of scssFiles) {
    const relativePath = path.relative(SRC_DIR, file);
    logInfo(`Checking ${relativePath}...`);
    
    const content = fs.readFileSync(file, 'utf8');
    const selectors = extractSelectors(content);
    
    for (const selector of selectors) {
      if (!selectorMap.has(selector)) {
        selectorMap.set(selector, []);
      }
      selectorMap.get(selector).push(relativePath);
    }
  }
  
  // Check for duplicates
  let hasErrors = false;
  let duplicateCount = 0;
  const dupeGroups = [];
  
  for (const [selector, files] of selectorMap.entries()) {
    if (files.length > 1) {
      // Exclude common Bootstrap / Angular Material patterns
      if (
        // Skip blank or utility selectors
        selector.trim() === '' ||
        // Skip selectors that start with common prefix patterns that are expected to repeat
        selector.startsWith('.mat-') ||
        selector.startsWith('.cdk-') ||
        selector.startsWith('.fa-') ||
        // Skip Angular's special selectors
        selector.includes('::ng-deep') ||
        // Skip very simple utility selectors that might be legitimately reused
        selector === '.d-flex' ||
        selector === '.d-block' ||
        selector === '.w-100' ||
        selector === '.h-100' ||
        // Skip media query fragments
        selector.includes('@media')
      ) {
        continue;
      }
      
      duplicateCount++;
      dupeGroups.push({ selector, files });
      hasErrors = true;
    }
  }
  
  // Report results
  console.log('\n--- Duplicate CSS Selector Check Summary ---');
  
  if (duplicateCount === 0) {
    logSuccess('No duplicate CSS selectors found!');
    return 0;
  } else {
    logError(`Found ${duplicateCount} duplicate CSS selectors.`);
    
    // Sort duplicate groups by number of occurrences (most dupes first)
    dupeGroups.sort((a, b) => b.files.length - a.files.length);
    
    // Show the top 20 duplicates or all if less than 20
    const topDupes = dupeGroups.slice(0, 20);
    
    console.log('\nTop duplicate selectors:');
    for (const { selector, files } of topDupes) {
      logWarning(`Selector "${selector}" appears in ${files.length} files:`);
      files.forEach(file => console.log(`  - ${file}`));
      console.log();
    }
    
    if (dupeGroups.length > 20) {
      console.log(`...and ${dupeGroups.length - 20} more duplicate selectors.`);
    }
    
    console.log('\nRecommendations:');
    console.log('1. Consider moving common styles to shared style files');
    console.log('2. Use more specific selectors to avoid conflicts');
    console.log('3. Consider using CSS modules or component-scoped styles');
    console.log('4. Review your component architecture to reduce style duplication');
    
    return 1;
  }
}

// Run the check
checkDuplicateCss()
  .then(code => process.exit(code))
  .catch(err => {
    logError(`Unexpected error: ${err.message}`);
    process.exit(1);
  }); 