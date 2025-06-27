import { NestFactory } from "@nestjs/core";
import { AppModule } from "../app.module";
import { AlertService, AlertSeverity } from "../modules/auth/services/alert.service";
import { SecurityAlertService } from "../modules/auth/services/security-alert.service";

async function testAuthAlertIntegration() {
  console.log("=== Auth Event Alert Integration Test ===");
  
  const app = await NestFactory.createApplicationContext(AppModule);
  
  try {
    const alertService = app.get(AlertService);
    const securityAlertService = app.get(SecurityAlertService);
    
    console.log("✅ Services initialized successfully");
    
    // Test 1: Send a login failure alert
    console.log("\n🔐 Test 1: Sending login failure alert...");
    const loginFailureAlert = {
      title: "Login Failure Alert",
      message: "Failed login attempt for user admin@test.com from IP 192.168.1.103",
      severity: AlertSeverity.MEDIUM,
      timestamp: new Date(),
      ipAddress: "192.168.1.103",
      email: "admin@test.com",
      data: {
        eventType: "login_failure",
        userAgent: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
        failureReason: "Invalid credentials",
        attemptNumber: 3
      }
    };
    
    const loginFailureResult = await alertService.sendAlert(loginFailureAlert);
    console.log(`Login failure alert sent result: ${loginFailureResult}`);
    
    // Test 2: Send an account lockout alert
    console.log("\n🔒 Test 2: Sending account lockout alert...");
    const lockoutAlert = {
      title: "Account Lockout Alert",
      message: "User account locked due to excessive failed login attempts",
      severity: AlertSeverity.HIGH,
      timestamp: new Date(),
      ipAddress: "192.168.1.103",
      email: "admin@test.com",
      userId: 1,
      data: {
        eventType: "account_lockout",
        lockoutDuration: "30 minutes",
        failedAttempts: 5,
        lockoutReason: "Exceeded maximum login attempts"
      }
    };
    
    const lockoutResult = await alertService.sendAlert(lockoutAlert);
    console.log(`Account lockout alert sent result: ${lockoutResult}`);
    
    // Test 3: Send a suspicious activity alert
    console.log("\n🚨 Test 3: Sending suspicious activity alert...");
    const suspiciousAlert = {
      title: "Suspicious Login Activity",
      message: "Login from unusual location detected",
      severity: AlertSeverity.HIGH,
      timestamp: new Date(),
      ipAddress: "203.0.113.45",
      email: "user@test.com",
      userId: 2,
      data: {
        eventType: "suspicious_login",
        location: "Unknown Location (Country: Unknown)",
        previousLocation: "United States",
        timeSinceLastLogin: "2 hours",
        deviceFingerprint: "unknown_device"
      }
    };
    
    const suspiciousResult = await alertService.sendAlert(suspiciousAlert);
    console.log(`Suspicious activity alert sent result: ${suspiciousResult}`);
    
    // Test 4: Verify auth alerts were stored in database
    console.log("\n🔍 Test 4: Checking database for auth event alerts...");
    
    // Check for login failure alerts
    const loginFailureAlerts = await securityAlertService.getSecurityAlerts(10, 0, {
      search: "Login Failure"
    });
    console.log(`Found ${loginFailureAlerts.total} login failure alerts`);
    
    // Check for lockout alerts
    const lockoutAlerts = await securityAlertService.getSecurityAlerts(10, 0, {
      search: "Account Lockout"
    });
    console.log(`Found ${lockoutAlerts.total} account lockout alerts`);
    
    // Check for suspicious activity alerts
    const suspiciousAlerts = await securityAlertService.getSecurityAlerts(10, 0, {
      search: "Suspicious Login"
    });
    console.log(`Found ${suspiciousAlerts.total} suspicious activity alerts`);
    
    // Test 5: Verify all recent alerts
    console.log("\n📊 Test 5: Checking recent alerts in database...");
    const recentAlerts = await securityAlertService.getSecurityAlerts(10, 0);
    console.log(`Total recent alerts: ${recentAlerts.total}`);
    
    console.log("\nRecent alerts:");
    for (const alert of recentAlerts.items.slice(0, 5)) {
      console.log(`- [${alert.severity.toUpperCase()}] ${alert.title} (${alert.createdAt})`);
      if (alert.alertData) {
        const data = JSON.parse(alert.alertData);
        if (data.eventType) {
          console.log(`  Event Type: ${data.eventType}`);
        }
      }
    }
    
    // Test 6: Test alert filtering by severity
    console.log("\n🎯 Test 6: Testing alert filtering by severity...");
    const highSeverityAlerts = await securityAlertService.getSecurityAlerts(10, 0, {
      severity: "high"
    });
    console.log(`Found ${highSeverityAlerts.total} high severity alerts`);
    
    const mediumSeverityAlerts = await securityAlertService.getSecurityAlerts(10, 0, {
      severity: "medium"
    });
    console.log(`Found ${mediumSeverityAlerts.total} medium severity alerts`);
    
    console.log("\n✅ Auth event alert integration test completed successfully!");
    
  } catch (error) {
    console.error("❌ Test failed:", error.message);
    console.error(error.stack);
  } finally {
    await app.close();
  }
}

testAuthAlertIntegration().catch(console.error); 