import { Component, OnInit, inject, PLATFORM_ID } from '@angular/core';
import { FormBuilder, FormGroup, Validators, ReactiveFormsModule } from '@angular/forms';
import { AuthService } from '../../../core/services';
import { User } from '../../../models';
import { finalize } from 'rxjs';
import { CommonModule, isPlatformBrowser } from '@angular/common';
import { RouterModule } from '@angular/router';
import { FormsModule } from '@angular/forms';
import { Router } from '@angular/router';

@Component({
  selector: 'app-profile',
  templateUrl: './profile.component.html',
  styleUrls: ['./profile.component.scss'],
  standalone: true,
  imports: [CommonModule, ReactiveFormsModule, RouterModule, FormsModule]
})
export class ProfileComponent implements OnInit {
  profileForm!: FormGroup;
  loading = false;
  submitted = false;
  user: User | null = null;
  message = '';
  isError = false;
  private platformId = inject(PLATFORM_ID);
  
  // Account deletion properties
  showDeleteConfirmation = false;
  deleteConfirmationText = '';
  deletingAccount = false;

  constructor(
    private formBuilder: FormBuilder,
    private authService: AuthService,
    private router: Router
  ) { }

  ngOnInit(): void {
    // Initialize form with empty values
    this.profileForm = this.formBuilder.group({
      firstName: ['', Validators.required],
      lastName: ['', Validators.required],
      email: [{ value: '', disabled: true }]
    });
    
    // Only load user profile in the browser
    if (isPlatformBrowser(this.platformId)) {
      this.loading = true;
      
      // Load user profile data
      this.authService.getUserProfile()
        .pipe(
          finalize(() => {
            this.loading = false;
          })
        )
        .subscribe({
          next: (user: User) => {
            this.user = user;
            this.updateForm(user);
          },
          error: error => {
            this.isError = true;
            this.message = 'Failed to load profile: ' + (error?.message || 'Unknown error');
          }
        });
    }
  }

  // Convenience getter for easy access to form fields
  get f() { return this.profileForm.controls; }

  updateForm(user: User): void {
    this.profileForm.patchValue({
      firstName: user.firstName || '',
      lastName: user.lastName || '',
      email: user.email
    });
  }

  onSubmit(): void {
    this.submitted = true;
    
    // Stop here if form is invalid
    if (this.profileForm.invalid) {
      return;
    }
    
    this.loading = true;
    this.message = '';
    this.isError = false;
    
    // For now, just display a success message since update endpoint is not implemented
    // In a real app, this would call a profile update endpoint
    setTimeout(() => {
      this.loading = false;
      this.message = 'Profile updated successfully!';
    }, 1000);
  }
  
  // Account deletion methods
  deleteAccount(): void {
    if (this.deleteConfirmationText !== 'DELETE') {
      return;
    }
    
    this.deletingAccount = true;
    this.message = '';
    this.isError = false;
    
    this.authService.deleteAccount()
      .pipe(
        finalize(() => {
          this.deletingAccount = false;
        })
      )
      .subscribe({
        next: () => {
          // Account successfully deleted, redirect to login page
          this.message = 'Your account has been successfully deleted.';
          
          // Logout and redirect after a brief delay to show the success message
          setTimeout(() => {
            this.authService.logout().subscribe(() => {
              this.router.navigate(['/login']);
            });
          }, 2000);
        },
        error: (error: any) => {
          this.isError = true;
          this.message = 'Failed to delete account: ' + (error?.message || 'Unknown error');
        }
      });
  }
  
  cancelDeleteAccount(): void {
    this.showDeleteConfirmation = false;
    this.deleteConfirmationText = '';
  }
} 