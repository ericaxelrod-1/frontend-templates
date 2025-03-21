import { Component, OnInit } from '@angular/core';
import { FormBuilder, FormGroup, Validators, ReactiveFormsModule } from '@angular/forms';
import { AuthService } from '../../../core/services';
import { User } from '../../../models';
import { finalize } from 'rxjs';
import { CommonModule } from '@angular/common';

@Component({
  selector: 'app-profile',
  templateUrl: './profile.component.html',
  styleUrls: ['./profile.component.scss'],
  standalone: true,
  imports: [CommonModule, ReactiveFormsModule]
})
export class ProfileComponent implements OnInit {
  profileForm!: FormGroup;
  loading = false;
  submitted = false;
  user: User | null = null;
  message = '';
  isError = false;

  constructor(
    private formBuilder: FormBuilder,
    private authService: AuthService
  ) { }

  ngOnInit(): void {
    this.loading = true;
    
    // Initialize form with empty values
    this.profileForm = this.formBuilder.group({
      firstName: ['', Validators.required],
      lastName: ['', Validators.required],
      email: [{ value: '', disabled: true }]
    });
    
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
} 