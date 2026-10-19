import { Component } from '@angular/core';
import { RouterOutlet } from '@angular/router';
import { ConsentWidget } from './features/consent/consent-widget/consent-widget';

@Component({
  selector: 'app-root',
  standalone: true,
  imports: [RouterOutlet, ConsentWidget],
  templateUrl: './app.html',
})
export class App {}