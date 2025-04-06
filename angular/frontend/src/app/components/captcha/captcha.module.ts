import { NgModule } from '@angular/core';
import { CommonModule } from '@angular/common';
import { CaptchaSelectorComponent } from './captcha-selector.component';
import { MatCardModule } from '@angular/material/card';
import { MatButtonModule } from '@angular/material/button';
import { MatSelectModule } from '@angular/material/select';
import { MatFormFieldModule } from '@angular/material/form-field';
import { FormsModule } from '@angular/forms';

@NgModule({
  imports: [
    CommonModule,
    MatCardModule,
    MatButtonModule,
    MatSelectModule,
    MatFormFieldModule,
    FormsModule,
    CaptchaSelectorComponent
  ],
  exports: [
    CaptchaSelectorComponent
  ]
})
export class CaptchaModule { } 