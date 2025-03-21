import { Component, OnInit, OnDestroy } from '@angular/core';
import { FormBuilder, FormGroup, Validators, ReactiveFormsModule } from '@angular/forms';
import { Router } from '@angular/router';
import { Store, Select } from '@ngxs/store';
import { Observable, Subscription } from 'rxjs';
import { AuthState, AuthActions } from '../../../store/auth/auth.state';
import { CommonModule } from '@angular/common';

@Component({
  selector: 'app-register',
  templateUrl: './register.component.html',
  styleUrls: ['./register.component.scss'],
  standalone: true,
  imports: [CommonModule, ReactiveFormsModule]
})
export class RegisterComponent implements OnInit, OnDestroy {
  registerForm!: FormGroup;
  private subscription: Subscription = new Subscription();

  @Select(AuthState.loading) loading$!: Observable<boolean>;
  @Select(AuthState.error) error$!: Observable<string | null>;
  @Select(AuthState.isAuthenticated) isAuthenticated$!: Observable<boolean>;

  loading = false;
  submitted = false;
  error = '';

  constructor(
    private formBuilder: FormBuilder,
    private router: Router,
    private store: Store
  ) { }

  ngOnInit(): void {
    // Initialize form with validation
    this.registerForm = this.formBuilder.group({
      firstName: [''],
      lastName: [''],
      email: ['', [Validators.required, Validators.email]],
      password: ['', [Validators.required, Validators.minLength(8)]]
    });

    // Subscribe to state changes
    this.subscription.add(
      this.loading$.subscribe(loading => {
        this.loading = loading;
      })
    );

    this.subscription.add(
      this.error$.subscribe(error => {
        this.error = error || '';
      })
    );

    this.subscription.add(
      this.isAuthenticated$.subscribe(isAuthenticated => {
        if (isAuthenticated) {
          this.router.navigate(['/']);
        }
      })
    );
  }

  ngOnDestroy(): void {
    this.subscription.unsubscribe();
  }

  // Convenience getter for easy access to form fields
  get f() { return this.registerForm.controls; }

  onSubmit(): void {
    this.submitted = true;

    // Stop here if form is invalid
    if (this.registerForm.invalid) {
      return;
    }

    this.store.dispatch(new AuthActions.Register(
      this.f['email'].value,
      this.f['password'].value,
      this.f['firstName'].value,
      this.f['lastName'].value
    ));
  }
} 