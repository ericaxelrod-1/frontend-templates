import { Pipe, PipeTransform } from '@angular/core';

/**
 * Renders a byte count as a human-readable size.
 *
 * A pure pipe rather than a component method: called from a template binding a
 * method re-runs on every change detection pass, and this one is on the hot path
 * of a component that polls every 30 seconds.
 */
@Pipe({
  name: 'formatBytes',
  standalone: true,
  pure: true,
})
export class FormatBytesPipe implements PipeTransform {
  private readonly UNITS = ['Bytes', 'KB', 'MB', 'GB', 'TB', 'PB'];

  transform(value: number | null | undefined): string {
    if (value === null || value === undefined || !Number.isFinite(value) || value <= 0) {
      return '0 Bytes';
    }

    const exponent = Math.min(
      Math.floor(Math.log(value) / Math.log(1024)),
      this.UNITS.length - 1,
    );
    const scaled = value / Math.pow(1024, exponent);

    return `${parseFloat(scaled.toFixed(2))} ${this.UNITS[exponent]}`;
  }
}