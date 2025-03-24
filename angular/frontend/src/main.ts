import { bootstrapApplication } from '@angular/platform-browser';
import { appConfig } from './app/app.config';
import { AppComponent } from './app/app.component';
import { enableProdMode } from '@angular/core';
import { environment } from './environments/environment';

if (environment.production) {
  enableProdMode();
}

function bootstrap() {
  bootstrapApplication(AppComponent, appConfig)
    .catch(err => console.error(err));
}

// Enable HMR properly
if (environment.hmr) {
  if ((module as any).hot) {
    (module as any).hot.accept();
    (module as any).hot.dispose(() => {
      // Store application state if needed before reloading
      const rootElement = document.querySelector('app-root');
      if (rootElement) {
        document.body.removeChild(rootElement);
      }
    });
  }
  
  bootstrap();
} else {
  bootstrap();
}
