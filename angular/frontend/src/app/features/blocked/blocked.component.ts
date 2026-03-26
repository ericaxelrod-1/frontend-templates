import { Component } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ActivatedRoute } from '@angular/router';

@Component({
  selector: 'app-blocked',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './blocked.component.html',
  styleUrls: ['./blocked.component.scss']
})
export class BlockedComponent {
  regionCode = '';
  regionName = '';

  private regionNames: Record<string, string> = {
    'US-CA': 'California',
    'US-NY': 'New York',
    'US-TX': 'Texas',
    'US-FL': 'Florida',
    'US': 'United States',
    'DE': 'Germany',
    'FR': 'France',
    'IT': 'Italy',
    'ES': 'Spain',
    'NL': 'Netherlands',
    'AU-NSW': 'New South Wales',
    'AU-VIC': 'Victoria',
  };

  constructor(private route: ActivatedRoute) {
    this.route.queryParams.subscribe((params) => {
      this.regionCode = params['code'] || '';
      this.regionName = this.regionNames[this.regionCode] || this.regionCode || 'your region';
    });
  }
}