# Project Backlog

Last Updated: 2025-07-17 12:00:00

## Critical Priority

### FEAT-127: Simple vs Enhanced Test Mode for Pattern Detection
- **Status**: Not Started
- **Testing**: Not Started
- **Dependencies**: BUG-126 (Pattern Detection must be working)
- **Added**: 2025-07-17 14:35:36
- **Description**: Add dual test modes (Simple/Enhanced) to pattern detection test buttons. Simple mode creates isolated test data triggering only the selected pattern. Enhanced mode creates realistic scenarios triggering multiple related patterns as would occur in real attacks.

#### Problem Statement
Currently, clicking any test button (e.g., IP Hopping) creates test data that triggers multiple pattern detections because the test data naturally matches multiple pattern criteria. While this is realistic, it makes it difficult to:
1. Test individual pattern detection algorithms in isolation
2. Understand which patterns are expected vs unexpected
3. Create clean demonstrations
4. Debug specific pattern detection logic

#### Solution Overview
Implement a toggle button that switches between:
- **Simple Mode**: Creates minimal, isolated test data that triggers ONLY the selected pattern
- **Enhanced Mode**: Creates realistic attack scenarios that trigger multiple related patterns (current behavior)

#### Detailed Implementation Plan

##### 1. Frontend - Update Pattern Detection Component TypeScript
**File**: `angular/frontend/src/app/modules/admin/pattern-detection/pattern-detection.component.ts`

**Step 1.1**: Add new properties to the component class (after line 72, before constructor):
```typescript
  // Test mode state - controls whether to use simple or enhanced test data
  testMode: 'simple' | 'enhanced' = 'simple';
  
  // Expected test results for tooltips - maps each test type to expected patterns
  testExpectations = {
    simple: {
      brute_force: ['Brute Force (1 pattern)'],
      distributed_attack: ['Distributed Attack (1 pattern)'],
      credential_stuffing: ['Credential Stuffing (1 pattern)'],
      rapid_account_switching: ['Rapid Account Switching (1 pattern)'],
      ip_hopping: ['IP Hopping (1 pattern)'],
      suspicious_location: ['Suspicious Location (1 pattern)'],
      time_anomaly: ['Time Anomaly (1 pattern)']
    },
    enhanced: {
      brute_force: [
        'Brute Force (1 pattern)',
        'Suspicious Location (2-3 patterns)',
        'Rapid Account Switching (1 pattern)'
      ],
      distributed_attack: [
        'Distributed Attack (1 pattern)',
        'Suspicious Location (4 patterns)',
        'IP Hopping (1 pattern)'
      ],
      credential_stuffing: [
        'Credential Stuffing (1 pattern)',
        'Brute Force (1 pattern)',
        'Suspicious Location (1 pattern)'
      ],
      rapid_account_switching: [
        'Rapid Account Switching (1 pattern)',
        'Suspicious Location (1 pattern)',
        'Brute Force (1 pattern)'
      ],
      ip_hopping: [
        'IP Hopping (1 pattern)',
        'Suspicious Location (3-5 patterns)',
        'Distributed Attack (1 pattern)',
        'Rapid Account Switching (1-2 patterns)'
      ],
      suspicious_location: [
        'Suspicious Location (1-3 patterns)',
        'Time Anomaly (1 pattern)'
      ],
      time_anomaly: [
        'Time Anomaly (1 pattern)',
        'Suspicious Location (1 pattern)'
      ]
    }
  };
```

**Step 1.2**: Add helper method for tooltips (after ngOnDestroy, before checkPermissions):
```typescript
  /**
   * Get tooltip text showing expected patterns for a test button
   * @param patternType The type of pattern test (e.g., 'ip_hopping')
   * @returns Formatted tooltip text listing expected patterns
   */
  getTestTooltip(patternType: string): string {
    const expectations = this.testExpectations[this.testMode][patternType];
    return `This test will create:\n${expectations.join('\n')}`;
  }
```

**Step 1.3**: Update ALL test creation methods to pass the mode parameter. For each method (createTestBruteForce, createTestDistributedAttack, etc.), update the service call:

```typescript
  createTestBruteForce(): void {
    this.isCreatingTestData = true;
    this.patternDetectionService.createTestPattern('brute_force', this.testMode)  // ADD this.testMode
      .pipe(takeUntil(this.destroy$))
      .subscribe({
        next: () => {
          this.loadData();
          this.loadPatternSummary();
          this.isCreatingTestData = false;
        },
        error: (error) => {
          console.error('Error creating test brute force pattern:', error);
          this.isCreatingTestData = false;
        }
      });
  }
```

**IMPORTANT**: Update ALL 7 test methods:
- createTestBruteForce()
- createTestDistributedAttack()
- createTestCredentialStuffing()
- createTestRapidAccountSwitching()
- createTestIpHopping()
- createTestSuspiciousLocation()
- createTestTimeAnomaly()

##### 2. Frontend - Import Required Modules
**File**: `angular/frontend/src/app/modules/admin/pattern-detection/pattern-detection.component.ts`

Add these imports at the top of the file (after existing imports):
```typescript
import { FormsModule } from '@angular/forms';
import { MatButtonToggleModule } from '@angular/material/button-toggle';
import { MatTooltipModule } from '@angular/material/tooltip';
import { MatExpansionModule } from '@angular/material/expansion';
```

Update the component's imports array in the @Component decorator:
```typescript
  imports: [
    CommonModule,
    MatTableModule,
    MatSortModule,
    MatPaginatorModule,
    MatProgressSpinnerModule,
    MatIconModule,
    MatButtonModule,
    MatDividerModule,
    MatMenuModule,
    MatCardModule,
    FormsModule,                    // ADD THIS
    MatButtonToggleModule,          // ADD THIS  
    MatTooltipModule,               // ADD THIS
    MatExpansionModule,             // ADD THIS
    PatternDetectionFiltersComponent
  ],
```

##### 3. Frontend - Update Pattern Detection Service
**File**: `angular/frontend/src/app/modules/admin/pattern-detection/shared/pattern-detection.service.ts`

Update the createTestPattern method signature (around line 107):
```typescript
  /**
   * Create test pattern for testing purposes
   * @param patternType The type of pattern to create test data for
   * @param mode 'simple' for isolated patterns, 'enhanced' for realistic multi-pattern scenarios
   */
  createTestPattern(patternType: string, mode: 'simple' | 'enhanced' = 'simple'): Observable<any> {
    return this.http.post(`${this.apiUrl}/patterns/test/${patternType}`, { mode })
      .pipe(catchError(this.handleError));
  }
```

##### 4. Frontend - Update HTML Template
**File**: `angular/frontend/src/app/modules/admin/pattern-detection/pattern-detection.component.html`

Replace the ENTIRE test data section (lines 138-199) with:
```html
<!-- Test Data Generation Section -->
@if (hasPermission) {
  <div class="test-data-section" id="test-data-section">
    <div class="test-section-header" id="test-section-header">
      <h3>Test Pattern Generation</h3>
      
      <!-- Mode Toggle -->
      <mat-button-toggle-group 
        [(ngModel)]="testMode" 
        class="test-mode-toggle"
        id="test-mode-toggle"
        aria-label="Test mode selection">
        
        <mat-button-toggle 
          value="simple" 
          id="test-mode-simple"
          [matTooltip]="'Simple Mode: Creates isolated test data that triggers only the selected pattern type. Ideal for testing individual detection algorithms.'"
          matTooltipPosition="above">
          <mat-icon>looks_one</mat-icon>
          Simple
        </mat-button-toggle>
        
        <mat-button-toggle 
          value="enhanced"
          id="test-mode-enhanced"
          [matTooltip]="'Enhanced Mode: Creates realistic attack scenarios that may trigger multiple related patterns. This simulates real-world security incidents where attackers use multiple techniques simultaneously.'"
          matTooltipPosition="above">
          <mat-icon>layers</mat-icon>
          Enhanced
        </mat-button-toggle>
      </mat-button-toggle-group>
    </div>

    <div class="test-buttons" id="test-buttons-container">
      <!-- Brute Force Button -->
      <button mat-raised-button 
              color="accent"
              id="test-button-brute-force"
              (click)="createTestBruteForce()"
              [disabled]="isCreatingTestData"
              [matTooltip]="getTestTooltip('brute_force')"
              matTooltipPosition="above"
              class="test-pattern-button">
        <mat-icon>lock_open</mat-icon>
        Brute Force
        @if (testMode === 'enhanced') {
          <mat-icon class="multi-pattern-indicator" 
                    matTooltip="Will trigger multiple patterns">
            warning
          </mat-icon>
        }
      </button>

      <!-- Distributed Attack Button -->
      <button mat-raised-button 
              color="accent"
              id="test-button-distributed-attack"
              (click)="createTestDistributedAttack()"
              [disabled]="isCreatingTestData"
              [matTooltip]="getTestTooltip('distributed_attack')"
              matTooltipPosition="above"
              class="test-pattern-button">
        <mat-icon>share</mat-icon>
        Distributed Attack
        @if (testMode === 'enhanced') {
          <mat-icon class="multi-pattern-indicator">warning</mat-icon>
        }
      </button>

      <!-- Credential Stuffing Button -->
      <button mat-raised-button 
              color="accent"
              id="test-button-credential-stuffing"
              (click)="createTestCredentialStuffing()"
              [disabled]="isCreatingTestData"
              [matTooltip]="getTestTooltip('credential_stuffing')"
              matTooltipPosition="above"
              class="test-pattern-button">
        <mat-icon>list</mat-icon>
        Credential Stuffing
        @if (testMode === 'enhanced') {
          <mat-icon class="multi-pattern-indicator">warning</mat-icon>
        }
      </button>

      <!-- Rapid Account Switching Button -->
      <button mat-raised-button 
              color="accent"
              id="test-button-rapid-switching"
              (click)="createTestRapidAccountSwitching()"
              [disabled]="isCreatingTestData"
              [matTooltip]="getTestTooltip('rapid_account_switching')"
              matTooltipPosition="above"
              class="test-pattern-button">
        <mat-icon>swap_horiz</mat-icon>
        Rapid Account Switching
        @if (testMode === 'enhanced') {
          <mat-icon class="multi-pattern-indicator">warning</mat-icon>
        }
      </button>

      <!-- IP Hopping Button -->
      <button mat-raised-button 
              color="accent"
              id="test-button-ip-hopping"
              (click)="createTestIpHopping()"
              [disabled]="isCreatingTestData"
              [matTooltip]="getTestTooltip('ip_hopping')"
              matTooltipPosition="above"
              class="test-pattern-button">
        <mat-icon>shuffle</mat-icon>
        IP Hopping
        @if (testMode === 'enhanced') {
          <mat-icon class="multi-pattern-indicator">warning</mat-icon>
        }
      </button>

      <!-- Suspicious Location Button -->
      <button mat-raised-button 
              color="accent"
              id="test-button-suspicious-location"
              (click)="createTestSuspiciousLocation()"
              [disabled]="isCreatingTestData"
              [matTooltip]="getTestTooltip('suspicious_location')"
              matTooltipPosition="above"
              class="test-pattern-button">
        <mat-icon>location_on</mat-icon>
        Suspicious Location
        @if (testMode === 'enhanced') {
          <mat-icon class="multi-pattern-indicator">warning</mat-icon>
        }
      </button>

      <!-- Time Anomaly Button -->
      <button mat-raised-button 
              color="accent"
              id="test-button-time-anomaly"
              (click)="createTestTimeAnomaly()"
              [disabled]="isCreatingTestData"
              [matTooltip]="getTestTooltip('time_anomaly')"
              matTooltipPosition="above"
              class="test-pattern-button">
        <mat-icon>schedule</mat-icon>
        Time Anomaly
        @if (testMode === 'enhanced') {
          <mat-icon class="multi-pattern-indicator">warning</mat-icon>
        }
      </button>

      <mat-divider vertical></mat-divider>

      <!-- Clear Test Data Button -->
      <button mat-raised-button 
              color="warn"
              id="test-button-clear-data"
              (click)="clearAllData()"
              [disabled]="isCreatingTestData">
        <mat-icon>delete</mat-icon>
        Clear Test Data
      </button>
    </div>

    <!-- Mode Explanation Panel -->
    <mat-expansion-panel class="test-mode-explanation" id="test-mode-explanation-panel">
      <mat-expansion-panel-header>
        <mat-panel-title>
          <mat-icon>info</mat-icon>
          Understanding Test Modes
        </mat-panel-title>
      </mat-expansion-panel-header>
      
      <div class="mode-explanation-content">
        <div class="mode-section simple-mode-section">
          <h4><mat-icon>looks_one</mat-icon> Simple Mode</h4>
          <p>Creates minimal, isolated test data designed to trigger only the selected pattern type. 
             Perfect for:</p>
          <ul>
            <li>Testing individual detection algorithms</li>
            <li>Debugging specific pattern logic</li>
            <li>Clean demonstrations</li>
            <li>Unit testing pattern detectors</li>
          </ul>
        </div>
        
        <div class="mode-section enhanced-mode-section">
          <h4><mat-icon>layers</mat-icon> Enhanced Mode</h4>
          <p>Creates realistic attack scenarios that naturally trigger multiple related patterns. 
             This reflects real-world behavior where:</p>
          <ul>
            <li>Attackers use multiple techniques simultaneously</li>
            <li>One attack method often exhibits characteristics of others</li>
            <li>Security systems must detect correlated threats</li>
            <li>Patterns overlap in realistic attack scenarios</li>
          </ul>
        </div>
      </div>
    </mat-expansion-panel>
  </div>
}
```

##### 5. Frontend - Add CSS Styles
**File**: `angular/frontend/src/app/modules/admin/pattern-detection/pattern-detection.component.scss`

Add these styles at the end of the file:
```scss
// Test Mode Styles
.test-section-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 1.5rem;
  flex-wrap: wrap;
  gap: 1rem;
  
  h3 {
    margin: 0;
  }
}

.test-mode-toggle {
  border: 1px solid rgba(var(--mdc-theme-primary-rgb), 0.5);
  border-radius: 4px;
  
  mat-button-toggle {
    &.mat-button-toggle-checked {
      background-color: var(--mdc-theme-primary);
      color: white;
      
      mat-icon {
        color: white;
      }
    }
  }
}

.test-pattern-button {
  position: relative;
  overflow: visible;
  
  .multi-pattern-indicator {
    position: absolute;
    top: -8px;
    right: -8px;
    background-color: #ff9800;
    color: white;
    border-radius: 50%;
    padding: 2px;
    font-size: 16px;
    width: 24px;
    height: 24px;
    display: flex;
    align-items: center;
    justify-content: center;
    animation: pulse 2s infinite;
    box-shadow: 0 2px 4px rgba(0, 0, 0, 0.3);
  }
}

@keyframes pulse {
  0% { 
    transform: scale(1);
    box-shadow: 0 2px 4px rgba(0, 0, 0, 0.3);
  }
  50% { 
    transform: scale(1.1);
    box-shadow: 0 2px 8px rgba(255, 152, 0, 0.5);
  }
  100% { 
    transform: scale(1);
    box-shadow: 0 2px 4px rgba(0, 0, 0, 0.3);
  }
}

.test-mode-explanation {
  margin-top: 1rem;
  
  .mode-explanation-content {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 2rem;
    padding: 1rem 0;
    
    @media (max-width: 768px) {
      grid-template-columns: 1fr;
    }
  }
  
  .mode-section {
    h4 {
      display: flex;
      align-items: center;
      gap: 0.5rem;
      color: var(--mdc-theme-primary);
      margin-bottom: 0.5rem;
    }
    
    ul {
      margin-left: 1.5rem;
      line-height: 1.8;
    }
    
    &.simple-mode-section {
      mat-icon {
        color: #4caf50;
      }
    }
    
    &.enhanced-mode-section {
      mat-icon {
        color: #ff9800;
      }
    }
  }
}

// Responsive adjustments
@media (max-width: 768px) {
  .test-section-header {
    flex-direction: column;
    align-items: stretch;
    
    .test-mode-toggle {
      width: 100%;
      
      mat-button-toggle {
        flex: 1;
      }
    }
  }
}
```

##### 6. Backend - Update Controller
**File**: `angular/backend/src/modules/auth/controllers/pattern-detection.controller.ts`

**Step 6.1**: Add DTO class for the request body (add after imports, before @ApiTags):
```typescript
// DTO for test pattern creation request
class CreateTestPatternDto {
  @ApiProperty({ 
    enum: ['simple', 'enhanced'],
    default: 'simple',
    description: 'Test mode - simple creates isolated patterns, enhanced creates realistic multi-pattern scenarios'
  })
  mode?: 'simple' | 'enhanced';
}
```

**Step 6.2**: Update the createTestPattern method (starting around line 117):
```typescript
  @Post('patterns/test/:scenario')
  @UseGuards(JwtAuthGuard, PermissionGuard)
  @RequirePermission('login-monitoring:manage')
  @ApiBearerAuth()
  @ApiOperation({ 
    summary: 'Create test patterns for a specific scenario',
    description: 'Creates test login attempts that will trigger pattern detection. Simple mode creates isolated patterns, enhanced mode creates realistic multi-pattern scenarios.'
  })
  @ApiResponse({
    status: 201,
    description: 'Test pattern created successfully',
  })
  async createTestPattern(
    @Param('scenario')
    scenario:
      | 'brute_force'
      | 'distributed_attack'
      | 'credential_stuffing'
      | 'account_switching'
      | 'ip_hopping'
      | 'suspicious_location'
      | 'time_anomaly',
    @Body() createTestPatternDto: CreateTestPatternDto,  // ADD THIS PARAMETER
  ) {
    const mode = createTestPatternDto.mode || 'simple';  // ADD THIS LINE
    
    // Create test login attempts with mode
    await this.patternDetectionService.createTestLoginAttempts(scenario, mode);  // PASS mode

    // For simple mode, only detect the specific pattern type
    let detectedPatterns: any[];
    if (mode === 'simple') {
      // Run detection for only the requested pattern type
      detectedPatterns = await this.patternDetectionService.detectSpecificPattern(scenario);
    } else {
      // Enhanced mode - run full detection (current behavior)
      detectedPatterns = await this.patternDetectionService.detectAndStorePatterns();
    }
    
    console.log(
      `Test scenario '${scenario}' (${mode} mode) created. Detected and stored patterns:`,
      detectedPatterns.length,
    );

    return {
      success: true,
      message: `Test ${scenario} scenario created successfully in ${mode} mode. ${detectedPatterns.length} patterns detected and stored.`,
      scenario: scenario,
      mode: mode,
      patternsDetected: detectedPatterns.length,
      patterns: detectedPatterns.map(p => ({
        type: p.type,
        severity: p.severity
      }))
    };
  }
```

**Step 6.3**: Add the import for ApiProperty at the top of the file:
```typescript
import { ApiProperty } from '@nestjs/swagger';  // ADD THIS to the existing imports
```

##### 7. Backend - Update Pattern Detection Service
**File**: `angular/backend/src/modules/auth/services/pattern-detection.service.ts`

**Step 7.1**: Update the createTestLoginAttempts method signature (line 502):
```typescript
  async createTestLoginAttempts(
    scenarioType:
      | 'brute_force'
      | 'distributed_attack'
      | 'credential_stuffing'
      | 'account_switching'
      | 'ip_hopping'
      | 'suspicious_location'
      | 'time_anomaly',
    mode: 'simple' | 'enhanced' = 'enhanced',  // ADD THIS PARAMETER
  ): Promise<void> {
```

**Step 7.2**: Update each case in the switch statement to handle simple mode. Here's the pattern for each:

```typescript
    switch (scenarioType) {
      case 'brute_force':
        if (mode === 'simple') {
          // Simple mode: Minimal data that ONLY triggers brute force
          const simpleIP = '192.168.200.1';  // Use unique IP range for simple tests
          const simpleEmail = 'bruteforce.simple@test.example.com';
          
          // Create exactly 6 failed attempts (just above threshold of 5)
          for (let i = 0; i < 6; i++) {
            const attemptTime = new Date(now.getTime() - i * 120000); // 2 minutes apart
            await this.createTestAttempt({
              ipAddress: simpleIP,
              emailAttempted: simpleEmail,
              status: 'failed',
              attemptedAt: attemptTime,
              userAgent: 'Simple-Test-Agent/1.0',
              failureReason: 'invalid_credentials',
            });
          }
        } else {
          // Enhanced mode: existing code
          for (let i = 0; i < 8; i++) {
            const attemptTime = new Date(now.getTime() - i * 60000);
            await this.createTestAttempt({
              ipAddress: '192.168.100.50',
              emailAttempted: `test${i % 3}@example.com`,
              status: 'failed',
              attemptedAt: attemptTime,
              userAgent: 'Mozilla/5.0 (Test Browser)',
              failureReason: 'invalid_credentials',
            });
          }
        }
        break;

      case 'distributed_attack':
        if (mode === 'simple') {
          // Simple mode: Exactly 4 IPs (minimum for distributed) with same email
          const targetEmail = 'distributed.simple@test.example.com';
          const simpleIPs = ['10.200.0.1', '10.200.0.2', '10.200.0.3', '10.200.0.4'];
          
          for (let i = 0; i < simpleIPs.length; i++) {
            const attemptTime = new Date(now.getTime() - i * 600000); // 10 minutes apart
            await this.createTestAttempt({
              ipAddress: simpleIPs[i],
              emailAttempted: targetEmail,
              status: 'failed',
              attemptedAt: attemptTime,
              userAgent: `Simple-Test-Agent/${i}`,
              failureReason: 'invalid_credentials',
            });
          }
        } else {
          // Enhanced mode: existing code
          const targetEmail = 'admin@example.com';
          const ips = ['10.0.0.1', '10.0.0.2', '10.0.0.3', '10.0.0.4'];
          for (let i = 0; i < ips.length; i++) {
            const attemptTime = new Date(now.getTime() - i * 300000);
            await this.createTestAttempt({
              ipAddress: ips[i],
              emailAttempted: targetEmail,
              status: Math.random() > 0.5 ? 'failed' : 'success',
              attemptedAt: attemptTime,
              userAgent: `Mozilla/5.0 (Test Browser ${i})`,
              failureReason: Math.random() > 0.5 ? 'invalid_credentials' : undefined,
            });
          }
        }
        break;

      case 'credential_stuffing':
        if (mode === 'simple') {
          // Simple mode: Many different emails from one IP
          const stuffingIP = '192.168.201.1';
          const emails = [
            'user1.simple@test.com', 'user2.simple@test.com', 'user3.simple@test.com',
            'user4.simple@test.com', 'user5.simple@test.com', 'user6.simple@test.com',
            'user7.simple@test.com', 'user8.simple@test.com', 'user9.simple@test.com',
            'user10.simple@test.com'
          ];
          
          for (let i = 0; i < emails.length; i++) {
            const attemptTime = new Date(now.getTime() - i * 30000); // 30 seconds apart
            await this.createTestAttempt({
              ipAddress: stuffingIP,
              emailAttempted: emails[i],
              status: 'failed',
              attemptedAt: attemptTime,
              userAgent: 'Simple-Test-Agent/1.0',
              failureReason: 'invalid_credentials',
            });
          }
        } else {
          // Enhanced mode: existing code continues...
        }
        break;

      case 'rapid_account_switching':
        if (mode === 'simple') {
          // Simple mode: 4 different accounts from same IP
          const switchingIP = '192.168.202.1';
          const simpleEmails = [
            'alice.simple@test.com', 'bob.simple@test.com',
            'charlie.simple@test.com', 'diana.simple@test.com'
          ];
          
          for (let i = 0; i < simpleEmails.length; i++) {
            const attemptTime = new Date(now.getTime() - i * 90000); // 1.5 minutes apart
            await this.createTestAttempt({
              ipAddress: switchingIP,
              emailAttempted: simpleEmails[i],
              status: 'success',  // All successful to avoid brute force
              attemptedAt: attemptTime,
              userAgent: 'Simple-Test-Agent/1.0',
            });
          }
        } else {
          // Enhanced mode: existing code
        }
        break;

      case 'ip_hopping':
        if (mode === 'simple') {
          // Simple mode: Same email from 3 different IPs in short time
          const hoppingEmail = 'iphopper.simple@test.example.com';
          const simpleHoppingIPs = ['10.201.1.1', '10.201.1.2', '10.201.1.3'];
          
          for (let i = 0; i < simpleHoppingIPs.length; i++) {
            const attemptTime = new Date(now.getTime() - i * 180000); // 3 minutes apart
            await this.createTestAttempt({
              ipAddress: simpleHoppingIPs[i],
              emailAttempted: hoppingEmail,
              status: 'success',
              attemptedAt: attemptTime,
              userAgent: 'Simple-Test-Agent/1.0',
            });
          }
        } else {
          // Enhanced mode: existing code with 10 IPs
        }
        break;

      case 'suspicious_location':
        if (mode === 'simple') {
          // Simple mode: Single attempt from known suspicious IP
          await this.createTestAttempt({
            ipAddress: '45.67.89.12',  // Known VPN/proxy range
            emailAttempted: 'location.simple@test.example.com',
            status: 'success',
            attemptedAt: now,
            userAgent: 'Simple-Test-Agent/1.0 (VPN)',
            metadata: {
              geoLocation: 'Anonymous Proxy',
              riskScore: 0.9
            }
          });
        } else {
          // Enhanced mode: existing code
        }
        break;

      case 'time_anomaly':
        if (mode === 'simple') {
          // Simple mode: Login at unusual time (3 AM local)
          const anomalyTime = new Date();
          anomalyTime.setHours(3, 0, 0, 0);  // 3:00 AM
          
          await this.createTestAttempt({
            ipAddress: '192.168.203.1',
            emailAttempted: 'nightowl.simple@test.example.com',
            status: 'success',
            attemptedAt: anomalyTime,
            userAgent: 'Simple-Test-Agent/1.0',
            metadata: {
              localTime: '03:00',
              timezone: 'America/New_York'
            }
          });
        } else {
          // Enhanced mode: existing code
        }
        break;
    }
```

**Step 7.3**: Add the new method detectSpecificPattern (add after detectAndStorePatterns):
```typescript
  /**
   * Detect only a specific pattern type (for simple mode testing)
   * This method runs only the detector for the requested pattern type
   * @param patternType The specific pattern type to detect
   * @returns Array of detected patterns of only the specified type
   */
  async detectSpecificPattern(
    patternType: string
  ): Promise<DetectedPattern[]> {
    let patterns: DetectedPattern[] = [];

    // Map scenario names to pattern detection methods
    switch (patternType) {
      case 'brute_force':
        patterns = await this.detectBruteForceAttempts();
        break;
      case 'distributed_attack':
        patterns = await this.detectDistributedAttacks();
        break;
      case 'credential_stuffing':
        // Note: credential stuffing uses same detector as brute force
        // but with different thresholds - for simple mode, we'll
        // tag it specifically
        patterns = await this.detectBruteForceAttempts();
        patterns.forEach(p => {
          if (p.details.includes('multiple different emails')) {
            p.type = PatternType.CREDENTIAL_STUFFING;
          }
        });
        break;
      case 'rapid_account_switching':
      case 'account_switching':
        patterns = await this.detectRapidAccountSwitching();
        break;
      case 'ip_hopping':
        patterns = await this.detectIPHopping();
        break;
      case 'suspicious_location':
        patterns = await this.detectSuspiciousLocations();
        break;
      case 'time_anomaly':
        patterns = await this.detectTimeAnomalies();
        break;
      default:
        console.error(`Unknown pattern type: ${patternType}`);
        return [];
    }

    // Store the detected patterns
    const storedPatterns: DetectedPattern[] = [];
    for (const pattern of patterns) {
      const stored = await this.storePatternWithGrouping(pattern);
      if (stored) {
        storedPatterns.push(
          this.transformStoredPatternToDetectedPattern(stored),
        );
      }
    }

    return storedPatterns;
  }
```

##### 8. Testing Instructions

**Step 8.1**: Start the development servers:
** assume the development servers are already started... do NOT start them **

**Step 8.2**: Navigate to the Pattern Detection page:
1. Login as an admin user
2. Go to Admin > Login Monitoring
3. Click on the "Pattern Detection" tab

**Step 8.3**: Test Simple Mode:
1. Ensure "Simple" toggle is selected
2. Hover over each button to see the tooltip showing expected patterns
3. Click "IP Hopping" button
4. Verify that ONLY 1 IP Hopping pattern appears in the table
5. Click "Clear Test Data" button

**Step 8.4**: Test Enhanced Mode:
1. Switch toggle to "Enhanced"
2. Notice warning icons appear on buttons
3. Hover over buttons to see updated tooltips
4. Click "IP Hopping" button
5. Verify that multiple patterns appear (IP Hopping, Suspicious Location, etc.)
6. Click "Clear Test Data" button

**Step 8.5**: Test UI Elements:
1. Verify toggle button switches between modes
2. Verify tooltips appear on hover for all elements
3. Expand "Understanding Test Modes" panel
4. Verify responsive behavior on mobile viewport

##### 9. Troubleshooting Guide

**Issue**: Toggle button not appearing
- **Check**: FormsModule imported in component
- **Check**: MatButtonToggleModule imported
- **Check**: ngModel binding syntax is correct

**Issue**: Tooltips not showing
- **Check**: MatTooltipModule imported
- **Check**: matTooltip directive spelled correctly
- **Check**: Tooltip text method returns string

**Issue**: Service method signature mismatch
- **Check**: Both service and component pass mode parameter
- **Check**: Backend controller extracts mode from body
- **Check**: Mode defaults to 'simple' if not provided

**Issue**: Simple mode still creates multiple patterns
- **Check**: Backend detectSpecificPattern method implemented
- **Check**: Controller uses correct detection method based on mode
- **Check**: Test data uses unique IP ranges for simple mode

**Issue**: Warning icons not positioned correctly
- **Check**: Parent button has position: relative
- **Check**: Icon has position: absolute
- **Check**: CSS animation keyframes defined

#### Success Criteria
1. ✅ Toggle button switches between Simple and Enhanced modes
2. ✅ Tooltips display expected patterns for each button in each mode
3. ✅ Simple mode creates only 1 pattern matching the button clicked
4. ✅ Enhanced mode creates multiple patterns (current behavior)
5. ✅ Warning indicators appear on buttons in Enhanced mode
6. ✅ Help panel explains the difference between modes
7. ✅ All test buttons work correctly in both modes
8. ✅ Clear test data removes all test patterns

#### Notes for Implementer
- Use TypeScript strict mode - avoid 'any' types
- Test on both desktop and mobile viewports
- Ensure all Material Design components are properly imported
- Backend uses TypeORM repository pattern - don't use raw SQL
- Follow existing code style and naming conventions
- Add appropriate error handling for failed API calls
- Consider adding loading spinners during test creation
- Remember to update both frontend service and backend controller



### BUG-111: IP Reputation Tab Shows "No IP Selected" with No Selection Interface
- **Status**: Not Started
- **Testing**: Not Started
- **Dependencies**: None
- **Added**: 2025-01-26 19:30:00
- **Description**: IP Reputation tab shows "No IP Selected" message with no way to select IPs. User expects vertical bar chart of IPs ranked by recent attempts with block/unblock status, but current implementation requires clicking IPs in login attempts table.

#### Investigation Results (@999-bugfinder)
- **Current Architecture**: Click-based IP selection from login attempts table to view individual IP reputation
- **User Expectation**: Dashboard/overview approach with bar chart showing IP rankings and block status
- **Backend Support**: `/api/login-monitoring/ip/:ipAddress` endpoint exists for individual IP lookup
- **Missing**: Overview/dashboard endpoint for all IPs with statistics and ranking

#### Implementation Requirements
- **Issues**: 
  - Create dashboard view of all IPs with attempt counts
  - Implement bar chart visualization (suggested: vertical bars)
  - Add bulk IP management with block/unblock capabilities
  - Design IP ranking algorithm based on recent attempts
  - Add filtering for IP reputation dashboard

- **Files To Modify**:
  - `angular/backend/src/modules/auth/controllers/login-monitoring.controller.ts`
  - `angular/frontend/src/app/modules/admin/login-monitoring/ip-reputation/`
  - IP reputation dashboard components

## High Priority

### BUG-125: Angular SSR Build Not Generating Server Bundle
- **Status**: Not Started
- **Testing**: Not Started
- **Dependencies**: None
- **Added**: 2025-01-28 10:30:00
- **Description**: Angular SSR (Server-Side Rendering) build process is not generating server bundle despite having correct source files (server.ts and main.server.ts). This causes `npm run serve:ssr:frontend` to fail with missing server.mjs error.

#### Investigation Results (@999-bugfinder)
- **Current State**: 
  - Both `server.ts` and `main.server.ts` exist with correct content
  - `@angular/ssr` package installed (version 18.2.13)
  - Angular.json has `server: "src/main.server.ts"` configuration
  - Running `npm run build` only generates browser files in `dist/frontend/browser/`
  - No server directory or server.mjs file created in dist

- **Root Cause**: Angular 18's application builder (`@angular-devkit/build-angular:application`) requires additional SSR configuration beyond just having `server: "src/main.server.ts"` in angular.json

- **Missing Configuration**:
  - `tsconfig.server.json` file not found
  - No specific SSR build script in package.json
  - Application builder not configured to generate server-side bundles

#### Proposed Resolution
1. **Create `tsconfig.server.json`** with proper server-side TypeScript configuration
2. **Update angular.json** to include full SSR configuration for the application builder
3. **Add SSR build scripts** to package.json:
   - `build:ssr`: Build both browser and server bundles
   - `serve:ssr`: Serve the SSR application
4. **Verify server bundle generation** in `dist/frontend/server/`
5. **Test SSR functionality** to ensure hydration works correctly

#### Implementation Requirements
- **Files To Create**:
  - `angular/frontend/tsconfig.server.json`

- **Files To Modify**:
  - `angular/frontend/angular.json` - Add complete SSR configuration
  - `angular/frontend/package.json` - Add SSR-specific build scripts
  - `angular/frontend/src/app/app.config.ts` - Verify SSR providers configuration

- **Expected Outcome**:
  - Build process generates both browser and server bundles
  - `dist/frontend/server/server.mjs` file created
  - `npm run serve:ssr:frontend` runs successfully
  - Angular hydration (NG0505) warning resolved when running with SSR

