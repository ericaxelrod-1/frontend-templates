import { NgModule, APP_INITIALIZER } from '@angular/core';
import { CommonModule } from '@angular/common';
import { LoggerService } from './logger.service';

export function initializeLogging(logger: LoggerService) {
  return () => {
    // Nothing to do here, the logger service constructor does initialization
    return Promise.resolve();
  };
}

@NgModule({
  declarations: [],
  imports: [
    CommonModule
  ],
  providers: [
    LoggerService,
    {
      provide: APP_INITIALIZER,
      useFactory: initializeLogging,
      deps: [LoggerService],
      multi: true
    }
  ]
})
export class LoggingModule { } 