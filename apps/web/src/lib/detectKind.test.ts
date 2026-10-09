import { describe, expect, it } from 'vitest';
import { detectKind } from './detectKind';

describe('detectKind', () => {
  it.each([
    ['photo.jpg', 'image/jpeg', 'image'],
    ['photo.PNG', 'image/png', 'image'],
    ['photo.webp', '', 'image'],
    ['clip.mp4', 'video/mp4', 'video'],
    ['clip.MOV', '', 'video'],
    ['clip.webm', 'video/webm', 'video'],
    ['voice.m4a', 'audio/x-m4a', 'audio'],
    ['song.mp3', 'audio/mpeg', 'audio'],
    ['rec.wav', '', 'audio'],
  ])('%s (%s) → %s', (name, type, kind) => {
    expect(detectKind({ name, type })).toEqual({ kind });
  });

  it('HEIC는 아직 지원하지 않는다고 알려준다', () => {
    expect(detectKind({ name: 'IMG_0001.HEIC', type: '' })).toEqual({
      kind: 'unsupported',
      reason: 'heic',
    });
    expect(detectKind({ name: 'a.jpg', type: 'image/heic' })).toEqual({
      kind: 'unsupported',
      reason: 'heic',
    });
  });

  it('알 수 없는 파일은 unknown', () => {
    expect(detectKind({ name: 'notes.pdf', type: 'application/pdf' })).toEqual({
      kind: 'unsupported',
      reason: 'unknown',
    });
    expect(detectKind({ name: 'noext', type: '' })).toEqual({
      kind: 'unsupported',
      reason: 'unknown',
    });
  });
});
