import { SuspensionInfoPipe } from './suspension-info.pipe';

describe('SuspensionInfoPipe', () => {
  const pipe = new SuspensionInfoPipe();

  it('identifies null disabled_until as permanent disable', () => {
    const info = pipe.transform(null);
    expect(info.isTemporary).toBe(false);
    expect(info.isActive).toBe(true);
    expect(info.label).toContain('Permanent disable');
    expect(info.cssClass).toBe('suspension-badge--permanent');
  });

  it('identifies future disabled_until as active temporary suspension', () => {
    const future = new Date(Date.now() + 86400000).toISOString();
    const info = pipe.transform(future);
    expect(info.isTemporary).toBe(true);
    expect(info.isActive).toBe(true);
    expect(info.label).toContain('Temporary suspension (active)');
    expect(info.cssClass).toBe('suspension-badge--active');
  });

  it('identifies past disabled_until as expired temporary suspension', () => {
    const past = new Date(Date.now() - 86400000).toISOString();
    const info = pipe.transform(past);
    expect(info.isTemporary).toBe(true);
    expect(info.isActive).toBe(false);
    expect(info.label).toContain('Temporary suspension (expired)');
    expect(info.cssClass).toBe('suspension-badge--expired');
  });
});
