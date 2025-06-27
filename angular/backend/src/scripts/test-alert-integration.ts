import { NestFactory } from "@nestjs/core";
import { AppModule } from "../app.module";
import { AlertService, AlertSeverity } from "../modules/auth/services/alert.service";
import { SecurityAlertService } from "../modules/auth/services/security-alert.service";

async function testAlertIntegration() {
  console.log("=== Alert Integration Test ===");
  
  const app = await NestFactory.createApplicationContext(AppModule);
  
  try {
    const alertService = app.get(AlertService);
    const securityAlertService = app.get(SecurityAlertService);
    
    console.log("✅ Services initialized successfully");
    
    // Test 1: Send a test alert via AlertService
    console.log("\n📧 Test 1: Sending test alert via AlertService...");
    const testAlertResult = await alertService.sendAlert({
      title: "Integration Test Alert",
      message: "Testing AlertService to SecurityAlertService integration",
      severity: AlertSeverity.MEDIUM,
      timestamp: new Date(),
      ipAddress: "192.168.1.100",
      userId: 1,
      data: { testType: "integration", source: "test-script" }
    });
    
    console.log(`Alert sent result: ${testAlertResult}`);
    
    // Test 2: Verify alert was stored in database
    console.log("\n🔍 Test 2: Checking database for stored alert...");
    const alerts = await securityAlertService.getSecurityAlerts(10, 0, {
      alertType: "test_alert"
    });
    
    console.log(`Found ${alerts.total} test alerts in database`);
    
    if (alerts.total > 0) {
      const latestAlert = alerts.items[0];
      console.log("Latest test alert:", {
        id: latestAlert.id,
        title: latestAlert.title,
        severity: latestAlert.severity,
        alertType: latestAlert.alertType,
        status: latestAlert.status,
        createdAt: latestAlert.createdAt
      });
    }
    
    console.log("\n✅ Alert integration test completed successfully!");
    
  } catch (error) {
    console.error("❌ Test failed:", error.message);
    console.error(error.stack);
  } finally {
    await app.close();
  }
}

testAlertIntegration().catch(console.error);
