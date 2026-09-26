// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { toVisionSource, visionImageSource } from './visionImage';

const b64 = (bytes: number[]) => Buffer.from([...bytes, 0, 0, 0, 0, 0, 0, 0, 0]).toString('base64');
const JPEG = b64([0xff, 0xd8, 0xff, 0xe0]);
const PNG = b64([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const WEBP = Buffer.from('RIFF\0\0\0\0WEBPVP8 ').toString('base64');
const GIF = Buffer.from('GIF89a\0\0').toString('base64');

describe('visionImageSource', () => {
  it('strips the data URL prefix the browser sends (live 400 "invalid base64 data")', () => {
    expect(visionImageSource(`data:image/jpeg;base64,${JPEG}`)).toEqual({
      type: 'base64',
      media_type: 'image/jpeg',
      data: JPEG
    });
  });

  it('keeps bare base64 as it is', () => {
    expect(visionImageSource(JPEG)?.data).toBe(JPEG);
  });

  it('reads the type from the bytes, not the label', () => {
    expect(visionImageSource(`data:image/jpeg;base64,${PNG}`)?.media_type).toBe('image/png');
    expect(visionImageSource(PNG)?.media_type).toBe('image/png');
    expect(visionImageSource(WEBP)?.media_type).toBe('image/webp');
    expect(visionImageSource(GIF)?.media_type).toBe('image/gif');
  });

  it('falls back to a supported declared type and normalizes image/jpg', () => {
    const unknownBytes = Buffer.from('hello world!').toString('base64');
    expect(visionImageSource(`data:image/jpg;base64,${unknownBytes}`)?.media_type).toBe(
      'image/jpeg'
    );
    expect(
      visionImageSource(`data:image/webp;name=a.webp;base64,${unknownBytes}`)?.media_type
    ).toBe('image/webp');
  });

  it('refuses formats Claude cannot read and non-base64 text', () => {
    const heic = Buffer.from('\0\0\0\x18ftypheic').toString('base64');
    expect(visionImageSource(`data:image/heic;base64,${heic}`)).toBeNull();
    expect(visionImageSource('data:application/pdf;base64,JVBERi0xLjQK')).toBeNull();
    expect(visionImageSource('not base64 at all!')).toBeNull();
    expect(visionImageSource('')).toBeNull();
  });

  it('ignores line breaks inside the base64', () => {
    const wrapped = `${JPEG.slice(0, 8)}\n${JPEG.slice(8)}`;
    expect(visionImageSource(`data:image/jpeg;base64,${wrapped}`)?.data).toBe(JPEG);
  });
});

describe('toVisionSource', () => {
  it('always hands Claude bare base64, even for a type it does not know', () => {
    const heic = Buffer.from('\0\0\0\x18ftypheic').toString('base64');
    expect(toVisionSource(`data:image/heic;base64,${heic}`)).toEqual({
      type: 'base64',
      media_type: 'image/jpeg',
      data: heic
    });
    expect(toVisionSource(`data:image/png;base64,${PNG}`).media_type).toBe('image/png');
  });
});
