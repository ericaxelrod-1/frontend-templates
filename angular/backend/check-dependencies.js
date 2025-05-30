/**
 * Dependency Check Script for Dynamic Access Control System
 * 
 * This script checks if all necessary dependencies are installed
 * for the dynamic access control system to function properly.
 */

const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

// Required dependencies for the permissions system
const requiredDependencies = [
  'node-cache',
  '@nestjs/common',
  '@nestjs/core',
  'typeorm',
  'uuid',
  'dotenv',
  'glob'
];

console.log('Checking dependencies for Dynamic Access Control System...');

try {
  // Read the package.json file
  const packageJsonPath = path.join(__dirname, 'package.json');
  const packageJsonContent = fs.readFileSync(packageJsonPath, 'utf8');
  const packageJson = JSON.parse(packageJsonContent);
  
  // Combine dependencies and devDependencies
  const allDependencies = {
    ...packageJson.dependencies || {},
    ...packageJson.devDependencies || {}
  };
  
  // Check if all required dependencies are installed
  const missingDependencies = [];
  
  for (const dependency of requiredDependencies) {
    if (!allDependencies[dependency]) {
      missingDependencies.push(dependency);
    }
  }
  
  // If there are missing dependencies, install them
  if (missingDependencies.length > 0) {
    console.log(`Missing dependencies: ${missingDependencies.join(', ')}`);
    console.log('Installing missing dependencies...');
    
    try {
      execSync(`npm install ${missingDependencies.join(' ')} --legacy-peer-deps`, { 
        stdio: 'inherit',
        cwd: __dirname
      });
      console.log('Dependencies installed successfully!');
    } catch (error) {
      console.error('Error installing dependencies:', error.message);
      process.exit(1);
    }
  } else {
    console.log('All required dependencies are installed.');
  }
  
  // Check if TypeORM entities and migrations folders exist
  const directories = [
    path.join(__dirname, 'src/modules/permissions/entities'),
    path.join(__dirname, 'src/migrations')
  ];
  
  for (const directory of directories) {
    if (!fs.existsSync(directory)) {
      console.log(`Creating directory: ${directory}`);
      fs.mkdirSync(directory, { recursive: true });
    }
  }
  
  console.log('Dependency check completed successfully!');
  process.exit(0);
  
} catch (error) {
  console.error('Error checking dependencies:', error.message);
  process.exit(1);
} 