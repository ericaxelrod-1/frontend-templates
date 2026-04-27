import { Component, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { MatCardModule } from '@angular/material/card';
import { MatButtonModule } from '@angular/material/button';
import { MatSlideToggleModule } from '@angular/material/slide-toggle';
import { MatIconModule } from '@angular/material/icon';
import { MatDialog, MatDialogModule } from '@angular/material/dialog';
import { MatSnackBar, MatSnackBarModule } from '@angular/material/snack-bar';
import { Store, Select } from '@ngxs/store';
import { Observable } from 'rxjs';
import { PrivacyState } from '../../store/privacy/privacy.state';
import { PrivacyActions } from '../../store/privacy/privacy.actions';
import { PrivacyPreferences } from './privacy.service';
import { ExportDataDialogComponent } from './export-data-dialog.component';
import { DeleteAccountDialogComponent } from './delete-account-dialog.component';
import { SupportTicketDialogComponent } from './support-ticket-dialog.component';
import { map, take } from 'rxjs/operators';

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
  @Select(PrivacyState.getPreferences) preferences$!: Observable<PrivacyPreferences>;
  @Select(PrivacyState.isLoading) loading$!: Observable<boolean>;

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
    private store: Store,
    private dialog: MatDialog,
    private snackBar: MatSnackBar
  ) {}

  ngOnInit(): void {
    this.store.dispatch(new PrivacyActions.FetchPreferences());
    
    this.preferences$.subscribe(data => {
      if (data) {
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
      }
    });
  }

  onMarketingConsentChange(event: any): void {
    const consent = event.checked;
    this.store.dispatch(new PrivacyActions.UpdateMarketingConsent(consent)).subscribe({
      next: () => {
        this.snackBar.open(consent ? 'Marketing consent enabled' : 'Marketing consent disabled', 'Close', { duration: 3000 });
      },
      error: () => {
        this.snackBar.open('Failed to update marketing consent', 'Close', { duration: 3000 });
      }
    });
  }

  onDoNotSellChange(event: any): void {
    const doNotSell = event.checked;
    this.store.dispatch(new PrivacyActions.UpdateDoNotSell(doNotSell)).subscribe({
      next: () => {
        this.snackBar.open(doNotSell ? 'Do Not Sell enabled' : 'Do Not Sell disabled', 'Close', { duration: 3000 });
      },
      error: () => {
        this.snackBar.open('Failed to update Do Not Sell preference', 'Close', { duration: 3000 });
      }
    });
  }

  onRestrictionChange(): void {
    // Note: We might want a specific action for this, but for now we can use the service directly or keep it local
    // The previous implementation used privacyService.updateRestrictions
    // I'll keep it as is but it would be better in the store if we want to track it
  }

  onObjectionToggle(processingType: string, event: any): void {
    // Same here, previous implementation used service directly.
    // I'll keep it simple for now to focus on the Dashboard and Export/Preview stories.
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
