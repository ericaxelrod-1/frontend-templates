import { Component } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterModule } from '@angular/router';
import { PublicHeaderComponent } from '../../shared/components/public-header/public-header.component';
import { PublicFooterComponent } from '../../shared/components/public-footer/public-footer.component';
import { CookieConsentComponent } from '../../../shared/cookie-consent/cookie-consent.component';

@Component({
  selector: 'app-public-layout',
  standalone: true,
  imports: [CommonModule, RouterModule, PublicHeaderComponent, PublicFooterComponent, CookieConsentComponent],
  templateUrl: './public-layout.component.html',
  styleUrls: ['./public-layout.component.scss']
})
export class PublicLayoutComponent { }
