/**
 * Security Audit Script
 * 
 * This script automates security audits for the Angular frontend project.
 * It runs npm audit and generates a report with findings.
 * 
 * Usage:
 * - Run with `node tools/security-audit.js`
 * - Add the --fix flag to automatically fix vulnerabilities
 * - Add the --report flag to save results to a report file
 */

const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

// Configuration
const REPORT_DIR = path.join(__dirname, '../docs/security');
const REPORT_FILE = path.join(REPORT_DIR, `security-audit-${new Date().toISOString().split('T')[0]}.md`);

// Ensure report directory exists
if (!fs.existsSync(REPORT_DIR)) {
  fs.mkdirSync(REPORT_DIR, { recursive: true });
}

// Parse command line arguments
const args = process.argv.slice(2);
const shouldFix = args.includes('--fix');
const shouldReport = args.includes('--report');

console.log('Starting security audit...');

try {
  // Run the audit command
  const command = shouldFix ? 'npm audit fix --package-lock-only' : 'npm audit';
  const auditOutput = execSync(command, { encoding: 'utf8' });
  
  console.log(auditOutput);
  
  // Generate audit report if requested
  if (shouldReport) {
    const reportContent = `# Security Audit Report - ${new Date().toLocaleDateString()}

## Audit Command
\`\`\`
${command}
\`\`\`

## Audit Results
\`\`\`
${auditOutput}
\`\`\`

## Analysis
${auditOutput.includes('found 0 vulnerabilities') 
  ? 'No vulnerabilities were found in this audit.' 
  : 'Vulnerabilities were detected. Please review the audit results and take appropriate action.'}

## Next Steps
${auditOutput.includes('found 0 vulnerabilities')
  ? 'Continue regular security monitoring.' 
  : shouldFix 
    ? 'Review the fixes applied by npm audit fix and verify application functionality.' 
    : 'Run `node tools/security-audit.js --fix` to attempt automatic remediation.'}
`;

    fs.writeFileSync(REPORT_FILE, reportContent);
    console.log(`Report saved to ${REPORT_FILE}`);
  }
  
  // Alert on vulnerabilities found
  if (auditOutput.includes('found 0 vulnerabilities')) {
    console.log('✅ No vulnerabilities found!');
  } else {
    console.log('⚠️ Vulnerabilities detected! Review the audit results.');
  }
} catch (error) {
  console.error('Error running security audit:', error.message);
  if (shouldReport) {
    const errorReport = `# Security Audit Error Report - ${new Date().toLocaleDateString()}

## Error Details
\`\`\`
${error.message}
\`\`\`

## Next Steps
1. Review the error message above
2. Fix any configuration issues
3. Re-run the security audit
`;
    fs.writeFileSync(REPORT_FILE, errorReport);
    console.log(`Error report saved to ${REPORT_FILE}`);
  }
  process.exit(1);
} 