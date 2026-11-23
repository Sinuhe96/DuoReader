// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { markTextRange } from '../src/reader/marks';

function line(html: string): HTMLElement {
  const element = document.createElement('p');
  element.className = 'src';
  element.innerHTML = html;
  document.body.append(element);
  return element;
}

function markedText(element: HTMLElement): string {
  return Array.from(element.querySelectorAll('mark'))
    .map((mark) => mark.textContent)
    .join('');
}

describe('markTextRange', () => {
  it('wraps one slice without changing the line text', () => {
    const element = line('Jetzt erzähle ich');
    markTextRange(element, 6, 13, 'reader-mark');

    expect(element.querySelectorAll('mark')).toHaveLength(1);
    expect(element.querySelector('mark')?.textContent).toBe('erzähle');
    expect(element.textContent).toBe('Jetzt erzähle ich');
  });

  it('splits one mark per text node when the range crosses an inline element', () => {
    const element = line('Jetzt <i>erzähle</i> ich');
    markTextRange(element, 0, 18, 'reader-mark reader-highlight');

    expect(element.textContent).toBe('Jetzt erzähle ich');
    expect(element.querySelectorAll('mark')).toHaveLength(3);
    expect(markedText(element)).toBe('Jetzt erzähle ich');
    expect(element.querySelector('mark')?.className).toBe('reader-mark reader-highlight');
  });

  it('keeps offsets after an earlier range has split the text', () => {
    const element = line('abcdef');
    markTextRange(element, 0, 2, 'reader-mark');
    markTextRange(element, 4, 6, 'reader-mark');

    expect(Array.from(element.querySelectorAll('mark')).map((mark) => mark.textContent)).toEqual([
      'ab',
      'ef',
    ]);
    expect(element.textContent).toBe('abcdef');
  });

  it('never marks the pinyin line', () => {
    const element = line('<span class="pinyin">Hěn jiǔ</span>很久以前');
    markTextRange(element, 0, 4, 'reader-mark');

    expect(element.querySelector('.pinyin')?.querySelector('mark')).toBeNull();
    expect(element.querySelector('mark')?.textContent).toBe('很久以前');
  });

  it('ignores an empty or reversed range', () => {
    const element = line('text');
    markTextRange(element, 2, 2, 'reader-mark');
    markTextRange(element, 4, 1, 'reader-mark');

    expect(element.querySelector('mark')).toBeNull();
  });
});
