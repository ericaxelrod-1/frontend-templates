import { Component, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { MatCardModule } from '@angular/material/card';
import { MatButtonModule } from '@angular/material/button';
import { MatSlideToggleModule } from '@angular/material/slide-toggle';
import { MatIconModule } from '@angular/material/icon';
import { MatDialog, MatDialogModule } from '@angular/material/dialog';
import { MatSnackBar, MatSnackBarModule } from '@angular/material/snack-bar';
import { PrivacyService, PrivacyPreferences } from './privacy.service';
import { ExportDataDialogComponent } from './export-data-dialog.component';
import { DeleteAccountDialogComponent } from './delete-account-dialog.component';
import { SupportTicketDialogComponent } from './support-ticket-dialog.component';

@Component({
  selector: 'app-privacy-settings',
  standalone: true,
  imports: [
    CommonModule,
    FormsModule,
    MatCardModule,
    MatButtonModule,
    MatSlideToggleModule,
    MatIconModule,
    MatDialogModule,
    MatSnackBarModule
  ],
  templateUrl: './privacy-settings.component.html',
  styleUrls: ['./privacy-settings.component.scss']
})
export class PrivacySettingsComponent implements OnInit {
  preferences: PrivacyPreferences | null = null;
  loading = true;
  saving = false;

  restrictions = {
    restrictAnalytics: false,
    restrictMarketing: false,
    restrictThirdParty: false,
    restrictProfiling: false
  };

  processingTypes = [
    { key: 'analytics', label: 'Analytics', description: 'Object to data analysis and profiling' },
    { key: 'marketing', label: 'Marketing', description: 'Object to marketing communications' },
    { key: 'third_party', label: 'Third Party Sharing', description: 'Object to sharing with third parties' },
    { key: 'profiling', label: 'Automated Profiling', description: 'Object to automated decision-making' }
  ];

  objections: Record<string, string> = {};

  constructor(
    private privacyService: PrivacyService,
    private dialog: MatDialog,
    private snackBar: MatSnackBar
  ) {}

  ngOnInit(): void {
    this.loadPreferences();
  }

  loadPreferences(): void {
    this.privacyService.getPreferences().subscribe({
      next: (data) => {
        this.preferences = data;
        if (data.privacyRestrictions) {
          this.restrictions = {
            restrictAnalytics: data.privacyRestrictions['analytics'] || false,
            restrictMarketing: data.privacyRestrictions['marketing'] || false,
            restrictThirdParty: data.privacyRestrictions['third_party'] || false,
            restrictProfiling: data.privacyRestrictions['profiling'] || false
          };
        }
        if (data.processingObjections) {
          this.objections = data.processingObjections;
        }
        this.loading = false;
      },
      error: () => {
        this.snackBar.open('Failed to load privacy preferences', 'Close', { duration: 3000 });
        this.loading = false;
      }
    });
  }

  onMarketingConsentChange(event: any): void {
    const consent = event.checked;
    this.saving = true;
    this.privacyService.updateMarketingConsent(consent).subscribe({
      next: () => {
        this.snackBar.open(consent ? 'Marketing consent enabled' : 'Marketing consent disabled', 'Close', { duration: 3000 });
        this.saving = false;
      },
      error: () => {
        this.snackBar.open('Failed to update marketing consent', 'Close', { duration: 3000 });
        this.saving = false;
      }
    });
  }

  onDoNotSellChange(event: any): void {
    const doNotSell = event.checked;
    this.saving = true;
    this.privacyService.updateDoNotSell(doNotSell).subscribe({
      next: () => {
        this.snackBar.open(doNotSell ? 'Do Not Sell enabled' : 'Do Not Sell disabled', 'Close', { duration: 3000 });
        this.saving = false;
      },
      error: () => {
        this.snackBar.open('Failed to update Do Not Sell preference', 'Close', { duration: 3000 });
        this.saving = false;
      }
    });
  }

  onRestrictionChange(): void {
    const restrictions: Record<string, boolean> = {
      analytics: this.restrictions.restrictAnalytics,
      marketing: this.restrictions.restrictMarketing,
      third_party: this.restrictions.restrictThirdParty,
      profiling: this.restrictions.restrictProfiling
    };

    this.saving = true;
    this.privacyService.updateRestrictions(restrictions).subscribe({
      next: () => {
        this.snackBar.open('Privacy restrictions updated', 'Close', { duration: 3000 });
        this.saving = false;
      },
      error: () => {
        this.snackBar.open('Failed to update restrictions', 'Close', { duration: 3000 });
        this.saving = false;
      }
    });
  }

  onObjectionToggle(processingType: string, event: any): void {
    if (event.checked) {
      const reason = `Objection to ${processingType} processing`;
      this.privacyService.submitObjection(processingType, reason).subscribe({
        next: () => {
          this.objections[processingType] = reason;
          this.snackBar.open(`Objection to ${processingType} submitted`, 'Close', { duration: 3000 });
        },
        error: () => {
          this.snackBar.open('Failed to submit objection', 'Close', { duration: 3000 });
        }
      });
    } else {
      this.privacyService.removeObjection(processingType).subscribe({
        next: () => {
          delete this.objections[processingType];
          this.snackBar.open(`Objection to ${processingType} removed`, 'Close', { duration: 3000 });
        },
        error: () => {
          this.snackBar.open('Failed to remove objection', 'Close', { duration: 3000 });
        }
      });
    }
  }

  openExportDialog(): void {
    this.dialog.open(ExportDataDialogComponent, {
      width: '500px'
    });
  }

  openDeleteDialog(): void {
    const dialogRef = this.dialog.open(DeleteAccountDialogComponent, {
      width: '500px'
    });

    dialogRef.afterClosed().subscribe(result => {
      if (result === 'deleted') {
        window.location.href = '/';
      }
    });
  }

  openSupportTicket(): void {
    this.dialog.open(SupportTicketDialogComponent, {
      width: '500px'
    });
  }

  hasObjection(processingType: string): boolean {
    return !!this.objections[processingType];
  }
}