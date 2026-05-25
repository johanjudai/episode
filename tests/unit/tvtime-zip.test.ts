import { describe, it, expect } from 'vitest';
import { BlobWriter, TextReader, ZipWriter, configure } from '@zip.js/zip.js';
import { extractTvTimeZip, TvTimeZipError } from '$lib/data/tvtime-zip';

/* Build an in-memory encrypted ZIP, then verify the extractor decrypts
 * it and exposes the whitelisted CSV. */
async function buildTestZip(files: Record<string, string>, password: string): Promise<Blob> {
  configure({ useWebWorkers: false });
  const blobWriter = new BlobWriter('application/zip');
  const writer = new ZipWriter(blobWriter, { password, encryptionStrength: 3 });
  for (const [name, content] of Object.entries(files)) {
    await writer.add(name, new TextReader(content));
  }
  await writer.close();
  return blobWriter.getData();
}

describe('extractTvTimeZip', () => {
  const csv = 'tv_show_id,tv_show_name\n1,Pilot\n';

  it('decrypts and returns whitelisted entries with the correct password', async () => {
    const zip = await buildTestZip(
      { 'followed_tv_show.csv': csv, 'unrelated.csv': 'noise' },
      'hunter2'
    );
    const out = await extractTvTimeZip(zip, 'hunter2');
    expect(out['followed_tv_show.csv']).toBe(csv);
    /* Non-whitelisted files are ignored — even if present in the archive. */
    expect(Object.keys(out)).toEqual(['followed_tv_show.csv']);
  });

  it('raises BAD_PASSWORD when the password is wrong', async () => {
    const zip = await buildTestZip({ 'followed_tv_show.csv': csv }, 'right-one');
    await expect(extractTvTimeZip(zip, 'wrong-one')).rejects.toBeInstanceOf(TvTimeZipError);
    await expect(extractTvTimeZip(zip, 'wrong-one')).rejects.toMatchObject({
      code: 'BAD_PASSWORD'
    });
  });

  it('returns an empty object when none of the expected files are present', async () => {
    const zip = await buildTestZip({ 'random.csv': 'a,b\n1,2' }, 'pw');
    const out = await extractTvTimeZip(zip, 'pw');
    expect(out).toEqual({});
  });

  it('raises TOO_LARGE when an entry exceeds the cap', async () => {
    /* The entry itself is only a few KB but we tighten the cap to
     * a few hundred bytes so the check trips on the extracted text
     * length — the same code path that would catch a real ZIP
     * bomb dump in production. */
    const payload = 'tv_show_id,tv_show_name\n' + '1,Pilot\n'.repeat(200);
    const zip = await buildTestZip({ 'followed_tv_show.csv': payload }, 'pw');
    await expect(extractTvTimeZip(zip, 'pw', { maxEntryBytes: 256 })).rejects.toMatchObject({
      code: 'TOO_LARGE'
    });
  });
});
