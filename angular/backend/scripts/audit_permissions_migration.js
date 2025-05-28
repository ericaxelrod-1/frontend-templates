/**
 * Script to audit the permission-based access control migration
 * 
 * Usage: node audit_permissions_migration.js [directory]
 * 
 * If directory is not specified, the script will scan the current directory.
 */

const fs = require('fs');
const path = require('path');
const { exec } = require('child_process');
const util = require('util');

const execAsync = util.promisify(exec);

// Define patterns to look for
const PATTERNS = {
  // Old role-based patterns
  role: {
    systemRolesImport: /import\s+[^;]*SystemRoles[^;]*;/g,
    roleGuard: /RoleGuard/g,
    rolesDecorator: /@Roles\(/g,
    hasRole: /hasRole\(/g,
    explicitRoleNames: /["'](?:ADMIN|USER|SUPERADMIN|SUPERUSER)["']/g,
    userDotRole: /user\.role/g,
    roleProperty: /\.role\b(?!\s*:\s*)/g,
  },
  // New permission-based patterns
  permission: {
    permissionImport: /import\s+[^;]*Permission[^;]*;/g,
    permissionGuard: /PermissionGuard/g,
    requirePermission: /@RequirePermission\(/g,
    hasPermission: /hasPermission\(/g,
    checkUserPermission: /checkUserPermission\(/g,
    permissionFormat: /['"][\w-]+:[\w-]+['"]/g,
  }
};

// Files to ignore
const IGNORE_PATHS = [
  'node_modules',
  'dist',
  '.git',
  'scripts/audit_permissions_migration.js'
];

// File extensions to scan
const SCAN_EXTENSIONS = ['.ts', '.js', '.html'];

// Parse command line arguments
const directory = process.argv[2] || process.cwd();

// Stats to track
const stats = {
  totalFiles: 0,
  scannedFiles: 0,
  roleBasedFiles: 0,
  permissionBasedFiles: 0,
  mixedFiles: 0,
  totalRoleReferences: 0,
  totalPermissionReferences: 0,
  fileStats: [],
};

// Results to report
const results = {
  roleBased: [],
  permissionBased: [],
  mixed: [],
  highestRoleReferences: [],
  completionPercentage: 0,
};

async function scanDirectory(dir) {
  // Get list of files to scan
  const filesToScan = await getFilesToScan(dir);
  stats.totalFiles = filesToScan.length;
  
  // Process each file
  for (const file of filesToScan) {
    await processFile(file);
  }
  
  // Calculate completion percentage
  if (stats.totalRoleReferences + stats.totalPermissionReferences > 0) {
    results.completionPercentage = Math.round(
      (stats.totalPermissionReferences / 
      (stats.totalRoleReferences + stats.totalPermissionReferences)) * 100
    );
  }
  
  // Sort files by role references for reporting
  stats.fileStats.sort((a, b) => b.roleReferences - a.roleReferences);
  
  // Get highest role reference files
  results.highestRoleReferences = stats.fileStats
    .filter(file => file.roleReferences > 0)
    .slice(0, 10);
  
  // Generate the report
  generateReport();
}

async function getFilesToScan(dir) {
  const result = [];
  
  try {
    // Use git ls-files to get tracked files (more efficient)
    console.log(`Getting list of files to scan in ${dir}...`);
    const { stdout } = await execAsync('git ls-files', { cwd: dir });
    
    const files = stdout.split('\n').filter(Boolean);
    
    for (const file of files) {
      const fullPath = path.join(dir, file);
      const ext = path.extname(file).toLowerCase();
      
      // Only include files with specified extensions and not in ignore paths
      if (SCAN_EXTENSIONS.includes(ext) && !IGNORE_PATHS.some(ignore => file.includes(ignore))) {
        result.push(fullPath);
      }
    }
  } catch (error) {
    console.error(`Error getting files: ${error.message}`);
    
    // Fallback to recursive filesystem scan
    console.log('Falling back to filesystem scan...');
    await recursiveGetFiles(dir, result);
  }
  
  return result;
}

async function recursiveGetFiles(dir, result = []) {
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  
  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    
    // Skip ignored paths
    if (IGNORE_PATHS.some(ignore => fullPath.includes(ignore))) {
      continue;
    }
    
    if (entry.isDirectory()) {
      await recursiveGetFiles(fullPath, result);
    } else {
      const ext = path.extname(entry.name).toLowerCase();
      if (SCAN_EXTENSIONS.includes(ext)) {
        result.push(fullPath);
      }
    }
  }
  
  return result;
}

async function processFile(filePath) {
  try {
    const content = fs.readFileSync(filePath, 'utf8');
    stats.scannedFiles++;
    
    // Count pattern matches
    const roleMatches = {};
    const permissionMatches = {};
    let totalRoleMatches = 0;
    let totalPermissionMatches = 0;
    
    // Count role-based patterns
    for (const [key, pattern] of Object.entries(PATTERNS.role)) {
      const matches = (content.match(pattern) || []).length;
      roleMatches[key] = matches;
      totalRoleMatches += matches;
    }
    
    // Count permission-based patterns
    for (const [key, pattern] of Object.entries(PATTERNS.permission)) {
      const matches = (content.match(pattern) || []).length;
      permissionMatches[key] = matches;
      totalPermissionMatches += matches;
    }
    
    // Update stats
    stats.totalRoleReferences += totalRoleMatches;
    stats.totalPermissionReferences += totalPermissionMatches;
    
    // Categorize the file
    const fileStat = {
      file: filePath,
      roleReferences: totalRoleMatches,
      permissionReferences: totalPermissionMatches,
      rolePatterns: roleMatches,
      permissionPatterns: permissionMatches,
    };
    
    stats.fileStats.push(fileStat);
    
    // Categorize files
    if (totalRoleMatches > 0 && totalPermissionMatches === 0) {
      stats.roleBasedFiles++;
      results.roleBased.push(filePath);
    } else if (totalRoleMatches === 0 && totalPermissionMatches > 0) {
      stats.permissionBasedFiles++;
      results.permissionBased.push(filePath);
    } else if (totalRoleMatches > 0 && totalPermissionMatches > 0) {
      stats.mixedFiles++;
      results.mixed.push(filePath);
    }
    
  } catch (error) {
    console.error(`Error processing file ${filePath}: ${error.message}`);
  }
}

function generateReport() {
  console.log('===============================================');
  console.log('PERMISSION-BASED ACCESS CONTROL MIGRATION AUDIT');
  console.log('===============================================');
  console.log();
  
  console.log('SUMMARY:');
  console.log('---------');
  console.log(`Total files scanned: ${stats.scannedFiles}`);
  console.log(`Files using role-based control: ${stats.roleBasedFiles}`);
  console.log(`Files using permission-based control: ${stats.permissionBasedFiles}`);
  console.log(`Files using both systems: ${stats.mixedFiles}`);
  console.log();
  
  console.log('REFERENCES:');
  console.log('-----------');
  console.log(`Total role-based references: ${stats.totalRoleReferences}`);
  console.log(`Total permission-based references: ${stats.totalPermissionReferences}`);
  console.log(`Migration completion: ${results.completionPercentage}%`);
  console.log();
  
  console.log('TOP FILES REQUIRING MIGRATION:');
  console.log('----------------------------');
  results.highestRoleReferences.forEach((file, index) => {
    console.log(`${index + 1}. ${file.file} (${file.roleReferences} role references)`);
  });
  console.log();
  
  // Save full report to file
  const fullReport = {
    summary: {
      totalFiles: stats.totalFiles,
      scannedFiles: stats.scannedFiles,
      roleBasedFiles: stats.roleBasedFiles,
      permissionBasedFiles: stats.permissionBasedFiles,
      mixedFiles: stats.mixedFiles,
      completionPercentage: results.completionPercentage,
    },
    references: {
      totalRoleReferences: stats.totalRoleReferences,
      totalPermissionReferences: stats.totalPermissionReferences,
    },
    files: {
      roleBased: results.roleBased,
      permissionBased: results.permissionBased,
      mixed: results.mixed,
    },
    fileDetails: stats.fileStats,
  };
  
  fs.writeFileSync(
    path.join(directory, 'permission_migration_report.json'), 
    JSON.stringify(fullReport, null, 2)
  );
  console.log('Full report saved to permission_migration_report.json');
}

// Run the script
scanDirectory(directory)
  .catch(error => {
    console.error(`Error: ${error.message}`);
    process.exit(1);
  }); 