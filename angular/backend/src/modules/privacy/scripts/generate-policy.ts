import { NestFactory } from '@nestjs/core';
import { PrivacyModule } from '../privacy.module';
import { PrivacyRegistryService } from '../privacy-registry.service';
import * as fs from 'fs';
import * as path from 'path';

async function bootstrap() {
  const app = await NestFactory.createApplicationContext(PrivacyModule);
  const registry = app.get(PrivacyRegistryService);

  console.log('--- Automated Privacy Policy Generator ---');
  
  const providers = registry.getProviders();
  
  let policyContent = `# Privacy Policy\n\nLast updated: ${new Date().toLocaleDateString()}\n\n`;
  policyContent += `This document outlines our data collection practices and your rights under global privacy regulations.\n\n`;
  
  policyContent += `## 1. Data Collection\n\nWe collect data through the following services:\n\n`;
  
  providers.forEach(p => {
    policyContent += `### ${p.providerName}\n`;
    policyContent += `Internal ID: \`${p.providerName}\`\n`;
    policyContent += `Purpose: Standard service data processing.\n\n`;
  });

  policyContent += `## 2. Your Rights\n\n`;
  policyContent += `- **Right to Access:** You can export your data via the Privacy Dashboard.\n`;
  policyContent += `- **Right to Erasure:** You can request account deletion at any time.\n`;
  policyContent += `- **California Residents:** We respect Do Not Sell/Share requests.\n\n`;

  const outputPath = path.join(process.cwd(), 'PRIVACY_POLICY.md');
  
  // Write BOM-free for PowerShell compatibility
  fs.writeFileSync(outputPath, policyContent, { encoding: 'utf8' });
  
  console.log(`\nSuccessfully generated: ${outputPath}`);
  console.log(`Included ${providers.length} registered privacy providers.`);
  
  await app.close();
}

bootstrap();
