/**
 * Schedule Security Audit Script
 * 
 * This script helps set up automated security audits by creating:
 * 1. A Windows Task Scheduler task (for Windows)
 * 2. A cron job (for Unix-based systems)
 * 
 * Usage:
 * - Run with `node tools/schedule-security-audit.js`
 */

const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const os = require('os');

const projectRoot = path.join(__dirname, '..');
const scriptPath = path.join(__dirname, 'security-audit.js');

console.log('Security Audit Scheduling Tool');
console.log('------------------------------');
console.log(`Project root: ${projectRoot}`);
console.log(`Audit script: ${scriptPath}`);
console.log();

// Detect operating system
const isWindows = os.platform() === 'win32';
const isUnix = ['darwin', 'linux'].includes(os.platform());

if (isWindows) {
  setupWindowsScheduledTask();
} else if (isUnix) {
  setupUnixCronJob();
} else {
  console.log(`Unsupported operating system: ${os.platform()}`);
  console.log('Please set up scheduling manually.');
}

function setupWindowsScheduledTask() {
  console.log('Setting up Windows Scheduled Task...');
  
  // Create batch file to run the audit
  const batchFilePath = path.join(projectRoot, 'run-security-audit.bat');
  const batchFileContent = `@echo off
cd "${projectRoot}"
node "${scriptPath}" --fix --report
`;
  
  fs.writeFileSync(batchFilePath, batchFileContent);
  console.log(`Created batch file: ${batchFilePath}`);
  
  // Generate XML for task scheduler
  const taskName = 'AngularSecurityAudit';
  const taskXmlPath = path.join(projectRoot, 'security-audit-task.xml');
  const taskXml = `<?xml version="1.0" encoding="UTF-16"?>
<Task version="1.2" xmlns="http://schemas.microsoft.com/windows/2004/02/mit/task">
  <RegistrationInfo>
    <Description>Weekly security audit for Angular application</Description>
  </RegistrationInfo>
  <Triggers>
    <CalendarTrigger>
      <StartBoundary>2025-03-23T02:00:00</StartBoundary>
      <Enabled>true</Enabled>
      <ScheduleByWeek>
        <DaysOfWeek>
          <Friday />
        </DaysOfWeek>
        <WeeksInterval>1</WeeksInterval>
      </ScheduleByWeek>
    </CalendarTrigger>
  </Triggers>
  <Settings>
    <MultipleInstancesPolicy>IgnoreNew</MultipleInstancesPolicy>
    <DisallowStartIfOnBatteries>false</DisallowStartIfOnBatteries>
    <StopIfGoingOnBatteries>false</StopIfGoingOnBatteries>
    <AllowHardTerminate>true</AllowHardTerminate>
    <StartWhenAvailable>true</StartWhenAvailable>
    <RunOnlyIfNetworkAvailable>false</RunOnlyIfNetworkAvailable>
    <IdleSettings>
      <StopOnIdleEnd>false</StopOnIdleEnd>
      <RestartOnIdle>false</RestartOnIdle>
    </IdleSettings>
    <AllowStartOnDemand>true</AllowStartOnDemand>
    <Enabled>true</Enabled>
    <Hidden>false</Hidden>
    <RunOnlyIfIdle>false</RunOnlyIfIdle>
    <WakeToRun>false</WakeToRun>
    <ExecutionTimeLimit>PT1H</ExecutionTimeLimit>
    <Priority>7</Priority>
  </Settings>
  <Actions Context="Author">
    <Exec>
      <Command>${batchFilePath}</Command>
      <WorkingDirectory>${projectRoot}</WorkingDirectory>
    </Exec>
  </Actions>
</Task>`;

  fs.writeFileSync(taskXmlPath, taskXml);
  console.log(`Created Task Scheduler XML: ${taskXmlPath}`);
  
  console.log('\nTo schedule the task, run the following command as administrator:');
  console.log(`schtasks /create /tn "${taskName}" /xml "${taskXmlPath}"`);
  console.log('\nAlternatively, you can:');
  console.log('1. Open Task Scheduler (taskschd.msc)');
  console.log('2. Click "Import Task..." from the Action menu');
  console.log(`3. Select the file: ${taskXmlPath}`);
}

function setupUnixCronJob() {
  console.log('Setting up Unix cron job...');
  
  // Create shell script to run the audit
  const shellScriptPath = path.join(projectRoot, 'run-security-audit.sh');
  const shellScriptContent = `#!/bin/bash
cd "${projectRoot}"
node "${scriptPath}" --fix --report
`;
  
  fs.writeFileSync(shellScriptPath, shellScriptContent);
  fs.chmodSync(shellScriptPath, '755');
  console.log(`Created shell script: ${shellScriptPath}`);
  
  // Create crontab entry
  const cronEntry = `# Angular Security Audit - Runs every Friday at 2:00 AM
0 2 * * 5 ${shellScriptPath}
`;
  
  const cronInstructionsPath = path.join(projectRoot, 'crontab-instructions.txt');
  fs.writeFileSync(cronInstructionsPath, cronEntry);
  console.log(`Created crontab instructions: ${cronInstructionsPath}`);
  
  console.log('\nTo schedule the cron job, run:');
  console.log('crontab -e');
  console.log('Then add the following line:');
  console.log(cronEntry);
} 