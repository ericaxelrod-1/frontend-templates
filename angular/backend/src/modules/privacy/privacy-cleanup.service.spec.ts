import { Test } from '@nestjs/testing';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { PrivacyCleanupService } from './privacy-cleanup.service';
import { PrivacyJob } from './entities/privacy-job.entity';
import { getRepositoryToken } from '@nestjs/typeorm';

const HOUR_MS = 60 * 60 * 1000;

describe('PrivacyCleanupService.purgeExpiredExports', () => {
  let exportRoot: string;
  let exportsDir: string;
  let service: PrivacyCleanupService;

  const writeExport = (name: string, ageMs: number, contents = 'x'): string => {
    const filePath = path.join(exportsDir, name);
    fs.writeFileSync(filePath, contents);
    const when = new Date(Date.now() - ageMs);
    fs.utimesSync(filePath, when, when);
    return filePath;
  };

  beforeEach(async () => {
    exportRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'privacy-exports-'));
    exportsDir = path.join(exportRoot, 'data/privacy/exports');
    // Spy before constructing: the service resolves its export root from
    // process.cwd() in a field initialiser, so the real data/privacy/exports
    // must never be the one under test.
    jest.spyOn(process, 'cwd').mockReturnValue(exportRoot);

    const moduleRef = await Test.createTestingModule({
      providers: [
        PrivacyCleanupService,
        {
          provide: getRepositoryToken(PrivacyJob),
          useValue: { find: jest.fn(), update: jest.fn(), save: jest.fn() },
        },
      ],
    }).compile();

    fs.mkdirSync(exportsDir, { recursive: true });
    service = moduleRef.get(PrivacyCleanupService);
  });

  afterEach(() => {
    jest.restoreAllMocks();
    fs.rmSync(exportRoot, { recursive: true, force: true });
  });

  it('removes only exports past the retention window', async () => {
    const expired = writeExport('expired.json', 48 * HOUR_MS);
    const fresh = writeExport('fresh.json', HOUR_MS);

    const result = await service.purgeExpiredExports();

    expect(result.removedFiles).toBe(1);
    expect(fs.existsSync(expired)).toBe(false);
    expect(fs.existsSync(fresh)).toBe(true);
  });

  it('reports how many files it looked at and how much space it freed', async () => {
    writeExport('a.json', 48 * HOUR_MS, '12345');
    writeExport('b.json', 48 * HOUR_MS, '12345');
    writeExport('c.json', HOUR_MS);

    const result = await service.purgeExpiredExports();

    expect(result.scannedFiles).toBe(3);
    expect(result.removedFiles).toBe(2);
    expect(result.freedBytes).toBe(10);
    expect(result.errors).toEqual([]);
  });

  it('is a no-op, not a crash, when the export directory does not exist', async () => {
    fs.rmSync(path.join(exportRoot, 'data'), { recursive: true, force: true });

    await expect(service.purgeExpiredExports()).resolves.toEqual({
      scannedFiles: 0,
      removedFiles: 0,
      freedBytes: 0,
      errors: [],
    });
  });

  it('records a per-file failure instead of reporting a clean sweep', async () => {
    writeExport('locked.json', 48 * HOUR_MS);
    jest.spyOn(fs, 'unlinkSync').mockImplementation(() => {
      throw new Error('EACCES: permission denied');
    });

    const result = await service.purgeExpiredExports();

    expect(result.removedFiles).toBe(0);
    expect(result.errors).toEqual([
      'Failed to delete file locked.json: EACCES: permission denied',
    ]);
  });

  it('is the same deletion path the nightly cron uses', async () => {
    const spy = jest.spyOn(service, 'purgeExpiredExports');
    const expired = writeExport('expired.json', 48 * HOUR_MS);

    await service.tempFileCleaner();

    expect(spy).toHaveBeenCalledTimes(1);
    expect(fs.existsSync(expired)).toBe(false);
  });
});
