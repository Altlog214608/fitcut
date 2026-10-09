import { describe, expect, it } from 'vitest';
import { parseYouTubeId } from './youtube';

describe('parseYouTubeId', () => {
  it.each([
    'https://www.youtube.com/watch?v=dQw4w9WgXcQ',
    'https://youtube.com/watch?v=dQw4w9WgXcQ&t=42s',
    'https://m.youtube.com/watch?v=dQw4w9WgXcQ',
    'https://youtu.be/dQw4w9WgXcQ?si=abc',
    'https://www.youtube.com/shorts/dQw4w9WgXcQ',
    'https://www.youtube.com/embed/dQw4w9WgXcQ',
    'https://www.youtube.com/live/dQw4w9WgXcQ',
    '  https://youtu.be/dQw4w9WgXcQ  ',
  ])('%s', (link) => {
    expect(parseYouTubeId(link)).toBe('dQw4w9WgXcQ');
  });

  it.each([
    'dQw4w9WgXcQ',
    'https://example.com/watch?v=dQw4w9WgXcQ',
    'https://www.youtube.com/watch?v=short',
    'https://www.youtube.com/channel/UC123',
    'https://youtu.be/',
    '',
  ])('%s → null', (link) => {
    expect(parseYouTubeId(link)).toBeNull();
  });
});
