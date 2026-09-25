import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { clearOutbox, dispatchEmail, readOutbox, type OutboundEmail } from './email';
import { minutesInWords, originBoundLine, smsLinkBody, smsLoginBody } from './otpMessage';

const ORIGIN = 'https://cropcard-dev-app.example-1f8b56e6.eastus2.azurecontainerapps.io';
const HOST = new URL(ORIGIN).host;
const CODE = '042917';

/** Apple AutoFill contract: origin-bound line is the last line, preceded by a
 *  blank line, and the code is the only digit run in the human text. */
function expectAutofillShape(text: string, code = CODE) {
  const lines = text.split('\n');
  expect(lines.at(-1)).toBe(`@${HOST} #${code}`);
  expect(lines.at(-2)).toBe('');
  const human = lines
    .slice(0, -2)
    .join('\n')
    .replace(/https?:\/\/\S+/g, '');
  expect(human.match(/\d+/g)).toEqual([code]);
  expect(human).toMatch(new RegExp(`code is ${code}\\b`));
}

describe('origin-bound line', () => {
  it('uses the configured origin host, port included', () => {
    expect(originBoundLine('http://localhost:5173', CODE)).toBe(`@localhost:5173 #${CODE}`);
    expect(originBoundLine(ORIGIN, CODE)).toBe(`@${HOST} #${CODE}`);
  });

  it('is omitted without a usable origin', () => {
    expect(originBoundLine(null, CODE)).toBeNull();
    expect(originBoundLine('not a url', CODE)).toBeNull();
    expect(smsLoginBody(CODE, 600_000, null)).not.toContain('@');
  });
});

describe('minutesInWords keeps digits out of the message', () => {
  it.each([
    [60_000, 'one minute'],
    [600_000, 'ten minutes'],
    [900_000, 'fifteen minutes'],
    [1_800_000, 'about half an hour'],
    [3_600_000, 'about an hour']
  ])('%i ms → %s', (ms, words) => {
    expect(minutesInWords(ms)).toBe(words);
  });
});

describe('SMS bodies', () => {
  it('sign-in code', () => {
    expectAutofillShape(smsLoginBody(CODE, 600_000, ORIGIN));
  });

  it('add-this-number code never echoes the phone number', () => {
    const body = smsLinkBody(CODE, 900_000, ORIGIN);
    expectAutofillShape(body);
    expect(body).not.toMatch(/571|555/);
  });
});

describe('email bodies', () => {
  const saved = process.env.EMAIL_TRANSPORT;
  beforeEach(() => {
    process.env.EMAIL_TRANSPORT = 'memory';
    clearOutbox();
  });
  afterEach(() => {
    process.env.EMAIL_TRANSPORT = saved;
  });

  async function send(email: OutboundEmail) {
    await dispatchEmail(email);
    return readOutbox(email.to).at(-1)!;
  }

  it('magic link: subject and body lead with the code; link and bound line follow', async () => {
    const m = await send({
      kind: 'magic-link',
      to: 'grower@example.test',
      loginUrl: `${ORIGIN}/auth/verify?token=abc123DEF456ghi789JKL012mno345PQR678`,
      code: CODE,
      expiresAt: Date.now() + 15 * 60_000
    });
    expect(m.subject).toBe(`Your CropCard sign-in code is ${CODE}`);
    expect(m.body.split('\n')[0]).toBe(`Your CropCard sign-in code is ${CODE}.`);
    expectAutofillShape(m.body);
  });

  it('contact verification', async () => {
    const m = await send({
      kind: 'contact-code',
      to: 'grower@example.test',
      code: CODE,
      expiresAt: Date.now() + 15 * 60_000,
      origin: ORIGIN
    });
    expect(m.subject).toBe(`Your CropCard verification code is ${CODE}`);
    expectAutofillShape(m.body);
  });
});
