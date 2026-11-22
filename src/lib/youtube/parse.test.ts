import { describe, expect, it } from 'vitest';
import { parseStartTime, parseYouTubeUrl } from './parse';

const ID = 'dQw4w9WgXcQ';

describe('parseYouTubeUrl', () => {
  it.each([
    ['watch', `https://www.youtube.com/watch?v=${ID}`],
    ['watch without www', `https://youtube.com/watch?v=${ID}`],
    ['watch with extra params', `https://www.youtube.com/watch?feature=share&v=${ID}&list=PL123`],
    ['watch without scheme', `www.youtube.com/watch?v=${ID}`],
    ['youtu.be', `https://youtu.be/${ID}`],
    ['youtu.be with query', `https://youtu.be/${ID}?si=abc`],
    ['shorts', `https://www.youtube.com/shorts/${ID}`],
    ['embed', `https://www.youtube.com/embed/${ID}`],
    ['live', `https://www.youtube.com/live/${ID}`],
    ['mobile', `https://m.youtube.com/watch?v=${ID}`],
    ['music', `https://music.youtube.com/watch?v=${ID}`],
    ['nocookie embed', `https://www.youtube-nocookie.com/embed/${ID}`],
    ['bare id', ID],
    ['bare id with spaces', `  ${ID}  `],
  ])('accepts %s', (_name, input) => {
    expect(parseYouTubeUrl(input)?.videoId).toBe(ID);
  });

  it.each([
    ['evilyoutube.com', `https://evilyoutube.com/watch?v=${ID}`],
    ['youtube.com.evil.io', `https://youtube.com.evil.io/watch?v=${ID}`],
    ['10-char id', 'dQw4w9WgXc'],
    ['12-char id', 'dQw4w9WgXcQQ'],
    ['10-char id in url', 'https://youtu.be/dQw4w9WgXc'],
    ['12-char id in url', 'https://www.youtube.com/watch?v=dQw4w9WgXcQQ'],
    ['empty', ''],
    ['whitespace', '   '],
    ['playlist only', 'https://www.youtube.com/playlist?list=PL123'],
    ['watch without v', 'https://www.youtube.com/watch'],
    ['non-http scheme', `javascript://youtube.com/watch?v=${ID}`],
    ['garbage', 'not a url at all'],
  ])('rejects %s', (_name, input) => {
    expect(parseYouTubeUrl(input)).toBeNull();
  });

  it('reads start times from t= and start=', () => {
    expect(parseYouTubeUrl(`https://youtu.be/${ID}?t=90`)).toEqual({ videoId: ID, startSec: 90 });
    expect(parseYouTubeUrl(`https://www.youtube.com/watch?v=${ID}&t=1m30s`)).toEqual({ videoId: ID, startSec: 90 });
    expect(parseYouTubeUrl(`https://www.youtube.com/embed/${ID}?start=12`)).toEqual({ videoId: ID, startSec: 12 });
  });

  it('omits startSec when there is no usable start time', () => {
    expect(parseYouTubeUrl(`https://youtu.be/${ID}?t=abc`)).toEqual({ videoId: ID });
    expect(parseYouTubeUrl(`https://youtu.be/${ID}?t=0`)).toEqual({ videoId: ID });
  });
});

describe('parseStartTime', () => {
  it.each([
    ['90', 90],
    ['90s', 90],
    ['1m30s', 90],
    ['1h2m3s', 3723],
    ['2m', 120],
  ])('parses %s', (raw, expected) => expect(parseStartTime(raw)).toBe(expected));

  it.each([[null], [''], ['x'], ['0'], ['-5'], ['1.5']])('ignores %s', (raw) => {
    expect(parseStartTime(raw)).toBeUndefined();
  });
});
