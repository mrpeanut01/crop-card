/** The image block Claude's vision API takes, from whatever a client sent:
 *  a `data:` URL (what `FileReader.readAsDataURL` gives the inventory label
 *  scan) or bare base64 (what `LabelCapture` gives). Sending a data URL as
 *  `data` makes the API answer 400 "invalid base64 data". */

export const VISION_MEDIA_TYPES = ['image/jpeg', 'image/png', 'image/gif', 'image/webp'] as const;
export type VisionMediaType = (typeof VISION_MEDIA_TYPES)[number];

export interface VisionImageSource {
  type: 'base64';
  media_type: VisionMediaType;
  data: string;
}

const DATA_URL = /^data:([^;,]*)(?:;[^,]*)?;base64,/i;

function sniff(data: string): VisionMediaType | null {
  let head: Buffer;
  try {
    head = Buffer.from(data.slice(0, 24), 'base64');
  } catch {
    return null;
  }
  if (head[0] === 0xff && head[1] === 0xd8 && head[2] === 0xff) return 'image/jpeg';
  if (head[0] === 0x89 && head.toString('latin1', 1, 4) === 'PNG') return 'image/png';
  if (head.toString('latin1', 0, 4) === 'GIF8') return 'image/gif';
  if (head.toString('latin1', 0, 4) === 'RIFF' && head.toString('latin1', 8, 12) === 'WEBP') {
    return 'image/webp';
  }
  return null;
}

function declared(type: string): VisionMediaType | null {
  const t = type.trim().toLowerCase().replace('image/jpg', 'image/jpeg');
  return (VISION_MEDIA_TYPES as readonly string[]).includes(t) ? (t as VisionMediaType) : null;
}

/** The vision source for an uploaded image, or null when it is empty or a
 *  format Claude can't read (HEIC, PDF, TIFF...). The bytes decide the
 *  type; the data URL's declared type is only a fallback. */
export function visionImageSource(input: string): VisionImageSource | null {
  const trimmed = input.trim();
  const m = DATA_URL.exec(trimmed);
  const data = (m ? trimmed.slice(m[0].length) : trimmed).replace(/\s+/g, '');
  if (!data || !/^[A-Za-z0-9+/_-]+={0,2}$/.test(data)) return null;
  const media = sniff(data) ?? (m ? declared(m[1]) : null);
  if (!media) return null;
  return { type: 'base64', media_type: media, data };
}

/** `visionImageSource`, or the bare base64 sent as JPEG when the format is
 *  unknown, so Claude rather than this parser has the last word on it. */
export function toVisionSource(input: string): VisionImageSource {
  const trimmed = input.trim();
  const m = DATA_URL.exec(trimmed);
  return (
    visionImageSource(trimmed) ?? {
      type: 'base64',
      media_type: 'image/jpeg',
      data: (m ? trimmed.slice(m[0].length) : trimmed).replace(/\s+/g, '')
    }
  );
}
