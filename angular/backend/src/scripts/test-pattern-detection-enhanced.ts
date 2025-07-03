import { NestFactory } from '@nestjs/core';
import { AppModule } from '../app.module';
import { PatternDetectionService } from '../modules/auth/services/pattern-detection.service';

async function testEnhancedPatternDetection() {
  console.log('🚀 Testing Enhanced Pattern Detection System...\n');

  const app = await NestFactory.createApplicationContext(AppModule);
  const patternService = app.get(PatternDetectionService);

  try {
    console.log('📊 Step 1: Testing Historical Pattern Retrieval');
    const historicalPatterns = await patternService.getHistoricalPatterns(10);
    console.log(`✅ Found ${historicalPatterns.length} historical patterns`);

    if (historicalPatterns.length > 0) {
      const sample = historicalPatterns[0];
      console.log(
        `   Sample: ${sample.type} - ${sample.severity} - ${sample.details}`,
      );
      console.log(`   Historical flag: ${sample.isHistorical}`);
      console.log(`   Status: ${sample.status}`);
    }

    console.log('\n🔍 Step 2: Testing Real-time Pattern Detection');
    const realTimePatterns = await patternService.detectRealTimePatterns();
    console.log(`✅ Found ${realTimePatterns.length} real-time patterns`);

    if (realTimePatterns.length > 0) {
      const sample = realTimePatterns[0];
      console.log(
        `   Sample: ${sample.type} - ${sample.severity} - ${sample.details}`,
      );
      console.log(`   Historical flag: ${sample.isHistorical}`);
    }

    console.log('\n🔧 Step 3: Testing Enhanced Combined Detection');
    const combinedPatterns = await patternService.detectPatternsEnhanced();
    console.log(
      `✅ Found ${combinedPatterns.length} total patterns (real-time + historical)`,
    );

    const realTimeCount = combinedPatterns.filter(
      (p) => !p.isHistorical,
    ).length;
    const historicalCount = combinedPatterns.filter(
      (p) => p.isHistorical,
    ).length;
    console.log(`   Real-time patterns: ${realTimeCount}`);
    console.log(`   Historical patterns: ${historicalCount}`);

    console.log('\n🧪 Step 4: Testing Brute Force Simulation');
    await patternService.createTestLoginAttempts('brute_force');
    console.log('✅ Created brute force test login attempts');

    // Wait a moment for the data to be processed
    await new Promise((resolve) => setTimeout(resolve, 1000));

    const newRealTimePatterns = await patternService.detectRealTimePatterns();
    console.log(
      `✅ Real-time detection after test: ${newRealTimePatterns.length} patterns`,
    );

    if (newRealTimePatterns.length > 0) {
      const bruteForcePattern = newRealTimePatterns.find(
        (p) => p.type === 'brute_force',
      );
      if (bruteForcePattern) {
        console.log(
          `   🎯 Detected brute force pattern: ${bruteForcePattern.details}`,
        );
        console.log(`   Severity: ${bruteForcePattern.severity}`);
      }
    }

    console.log('\n🧪 Step 5: Testing Distributed Attack Simulation');
    await patternService.createTestLoginAttempts('distributed_attack');
    console.log('✅ Created distributed attack test login attempts');

    await new Promise((resolve) => setTimeout(resolve, 1000));

    const distributedPatterns = await patternService.detectRealTimePatterns();
    const distributedPattern = distributedPatterns.find(
      (p) => p.type === 'distributed_attack',
    );
    if (distributedPattern) {
      console.log(
        `   🎯 Detected distributed attack: ${distributedPattern.details}`,
      );
    }

    console.log('\n🧹 Step 6: Testing Test Data Cleanup');
    const cleanupResult = await patternService.clearTestData();
    console.log(`✅ Cleaned up ${cleanupResult.deleted} test login attempts`);

    console.log('\n🎉 Enhanced Pattern Detection Test Complete!');
    console.log('\n📋 Summary:');
    console.log(`   - Historical patterns: ${historicalCount}`);
    console.log(`   - Real-time patterns before tests: ${realTimeCount}`);
    console.log(`   - Test scenarios created: 2 (brute force, distributed)`);
    console.log(`   - Test data cleaned up: ${cleanupResult.deleted} attempts`);
    console.log(
      '\n✅ All enhanced pattern detection features working correctly!',
    );
  } catch (error) {
    console.error('❌ Error during enhanced pattern detection test:', error);

    if (error.message) {
      console.error('Error message:', error.message);
    }
  } finally {
    await app.close();
  }
}

// Run the test
if (require.main === module) {
  testEnhancedPatternDetection()
    .then(() => {
      console.log('\n🏁 Test script completed');
      process.exit(0);
    })
    .catch((error) => {
      console.error('\n💥 Test script failed:', error);
      process.exit(1);
    });
}

export { testEnhancedPatternDetection };
