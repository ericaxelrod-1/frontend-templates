import { Component, OnInit, OnDestroy } from '@angular/core';
import { FormBuilder, FormGroup, Validators, ReactiveFormsModule } from '@angular/forms';
import { Router, ActivatedRoute } from '@angular/router';
import { Store, Select } from '@ngxs/store';
import { Observable, Subscription } from 'rxjs';
import { AuthState, AuthActions } from '../../../store/auth/auth.state';
import { CommonModule } from '@angular/common';

@Component({
  selector: 'app-login',
  templateUrl: './login.component.html',
  styleUrls: ['./login.component.scss'],
  standalone: true,
  imports: [CommonModule, ReactiveFormsModule]
})
export class LoginComponent implements OnInit, OnDestroy {
  loginForm!: FormGroup;
  returnUrl: string = '/';
  private subscription: Subscription = new Subscription();

  @Select(AuthState.loading) loading$!: Observable<boolean>;
  @Select(AuthState.error) error$!: Observable<string | null>;
  @Select(AuthState.isAuthenticated) isAuthenticated$!: Observable<boolean>;

  loading = false;
  submitted = false;
  error = '';

  constructor(
    private formBuilder: FormBuilder,
    private route: ActivatedRoute,
    private router: Router,
    private store: Store
  ) { }

  ngOnInit(): void {
    // Initialize form with validation
    this.loginForm = this.formBuilder.group({
      email: ['', [Validators.required, Validators.email]],
      password: ['', Validators.required]
    });

    // Get return URL from route parameters or default to home
    this.returnUrl = this.route.snapshot.queryParams['returnUrl'] || '/';

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
          this.router.navigate([this.returnUrl]);
        }
      })
    );
  }

  ngOnDestroy(): void {
    this.subscription.unsubscribe();
  }

  // Convenience getter for easy access to form fields
  get f() { return this.loginForm.controls; }

  onSubmit(): void {
    this.submitted = true;

    // Stop here if form is invalid
    if (this.loginForm.invalid) {
      return;
    }

    this.store.dispatch(new AuthActions.Login(
      this.f['email'].value,
      this.f['password'].value
    ));
  }
} 