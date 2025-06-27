import { NestFactory } from "@nestjs/core";
import { AppModule } from "../app.module";
import { AlertService, AlertSeverity } from "../modules/auth/services/alert.service";
import { SecurityAlertService } from "../modules/auth/services/security-alert.service";
import { DetectedPattern, PatternType } from "../modules/auth/services/pattern-detection.service";

async function testPatternAlertIntegration() {
  console.log("=== Pattern Alert Integration Test ===");
  
  const app = await NestFactory.createApplicationContext(AppModule);
  
  try {
    const alertService = app.get(AlertService);
    const securityAlertService = app.get(SecurityAlertService);
    
    console.log("✅ Services initialized successfully");
    
    // Test 1: Send a pattern detection alert via AlertService
    console.log("\n🚨 Test 1: Sending brute force pattern alert...");
    const bruteForcePattern: DetectedPattern = {
      type: PatternType.BRUTE_FORCE,
      severity: "high",
      timestamp: new Date(),
      ipAddress: "192.168.1.101",
      ipAddresses: ["192.168.1.101"],
      emails: ["admin@test.com", "user@test.com", "test@test.com", "root@test.com"],
      userId: null,
      details: "Multiple failed login attempts detected from IP 192.168.1.101",
      evidence: {
        ipAddress: "192.168.1.101",
        attemptCount: 8,
        timeWindow: "10 minutes",
        uniqueEmailCount: 4,
        attempts: [
          { email: "admin@test.com", timestamp: new Date(Date.now() - 600000) },
          { email: "user@test.com", timestamp: new Date(Date.now() - 480000) },
          { email: "test@test.com", timestamp: new Date(Date.now() - 360000) },
          { email: "root@test.com", timestamp: new Date(Date.now() - 240000) }
        ]
      }
    };
    
    const patternAlertResult = await alertService.sendPatternAlert(bruteForcePattern);
    console.log(`Pattern alert sent result: ${patternAlertResult}`);
    
    // Test 2: Verify pattern alert was stored in database
    console.log("\n🔍 Test 2: Checking database for pattern alert...");
    const patternAlerts = await securityAlertService.getSecurityAlerts(10, 0, {
      alertType: "pattern_brute_force"
    });
    
    console.log(`Found ${patternAlerts.total} pattern alerts in database`);
    
    if (patternAlerts.total > 0) {
      const latestPatternAlert = patternAlerts.items[0];
      console.log("Latest pattern alert:", {
        id: latestPatternAlert.id,
        title: latestPatternAlert.title,
        severity: latestPatternAlert.severity,
        alertType: latestPatternAlert.alertType,
        status: latestPatternAlert.status,
        ipAddress: latestPatternAlert.ipAddress,
        alertData: JSON.parse(latestPatternAlert.alertData || '{}'),
        createdAt: latestPatternAlert.createdAt
      });
    }
    
    // Test 3: Send a credential stuffing pattern alert
    console.log("\n🚨 Test 3: Sending credential stuffing pattern alert...");
    const credentialStuffingPattern: DetectedPattern = {
      type: PatternType.CREDENTIAL_STUFFING,
      severity: "critical",
      timestamp: new Date(),
      ipAddress: "192.168.1.102",
      ipAddresses: ["192.168.1.102"],
      emails: ["victim1@test.com", "victim2@test.com", "victim3@test.com"],
      userId: null,
      details: "Credential stuffing attack detected - rapid login attempts with different credentials",
      evidence: {
        ipAddress: "192.168.1.102",
        attemptCount: 15,
        timeWindow: "5 minutes",
        uniqueEmailCount: 12,
        successfulLogins: 0,
        attempts: []
      }
    };
    
    const credentialStuffingResult = await alertService.sendPatternAlert(credentialStuffingPattern);
    console.log(`Credential stuffing alert sent result: ${credentialStuffingResult}`);
    
    // Test 4: Verify credential stuffing alert was stored
    console.log("\n🔍 Test 4: Checking for credential stuffing alerts...");
    const credentialAlerts = await securityAlertService.getSecurityAlerts(10, 0, {
      alertType: "pattern_credential_stuffing"
    });
    
    console.log(`Found ${credentialAlerts.total} credential stuffing alerts in database`);
    
    if (credentialAlerts.total > 0) {
      const latestCredentialAlert = credentialAlerts.items[0];
      console.log("Latest credential stuffing alert:", {
        id: latestCredentialAlert.id,
        title: latestCredentialAlert.title,
        severity: latestCredentialAlert.severity,
        alertType: latestCredentialAlert.alertType,
        status: latestCredentialAlert.status,
        ipAddress: latestCredentialAlert.ipAddress,
        createdAt: latestCredentialAlert.createdAt
      });
    }
    
    // Test 5: Verify all alerts are retrievable
    console.log("\n📊 Test 5: Checking total alert count in database...");
    const allAlerts = await securityAlertService.getSecurityAlerts(20, 0);
    console.log(`Total alerts in database: ${allAlerts.total}`);
    
    console.log("\nAlert breakdown:");
    const alertTypeBreakdown = {};
    for (const alert of allAlerts.items) {
      alertTypeBreakdown[alert.alertType] = (alertTypeBreakdown[alert.alertType] || 0) + 1;
    }
    console.table(alertTypeBreakdown);
    
    console.log("\n✅ Pattern alert integration test completed successfully!");
    
  } catch (error) {
    console.error("❌ Test failed:", error.message);
    console.error(error.stack);
  } finally {
    await app.close();
  }
}

testPatternAlertIntegration().catch(console.error); 