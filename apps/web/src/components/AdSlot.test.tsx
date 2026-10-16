import { render } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { LangProvider } from '../i18n/LangProvider';
import { AdSlot } from './AdSlot';

afterEach(() => {
  delete window.adsbygoogle;
});

describe('AdSlot', () => {
  it('광고 단위 ID가 없으면 아무것도 그리지 않는다', () => {
    const { container } = render(
      <LangProvider>
        <AdSlot place="home" slots={{ home: '', tool: '' }} />
      </LangProvider>,
    );
    expect(container.innerHTML).toBe('');
    expect(window.adsbygoogle).toBeUndefined();
  });

  it('ID가 있으면 광고 표시를 붙이고 AdSense에 채워 달라고 한다', () => {
    const { container, getByRole } = render(
      <LangProvider>
        <AdSlot place="tool" slots={{ home: '', tool: '1234567890' }} />
      </LangProvider>,
    );
    expect(getByRole('complementary', { name: '광고' })).toBeTruthy();
    const ins = container.querySelector('ins.adsbygoogle');
    expect(ins?.getAttribute('data-ad-slot')).toBe('1234567890');
    expect(ins?.getAttribute('data-ad-client')).toBe('ca-pub-5555123248227301');
    expect(window.adsbygoogle).toHaveLength(1);
  });
});
