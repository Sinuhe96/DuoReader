/**
 * Sentence segmentation. `Intl.Segmenter` is the baseline; a fragment that
 * starts lowercase or is only a closing quote is folded back into the previous
 * sentence, which is what dialogue and OCR line breaks need.
 */
export function splitSentences(text: string, lang: string): string[] {
  const normalised = text.replace(/\s+/g, ' ').trim();
  if (!normalised) return [];
  const segmenter = new Intl.Segmenter(lang, { granularity: 'sentence' });
  const fragments = [...segmenter.segment(normalised)]
    .map((fragment) => fragment.segment.trim())
    .filter(Boolean);

  const sentences: string[] = [];
  for (const fragment of fragments) {
    const previous = sentences.at(-1);
    const quoteOnly = /^["'”’)\]]+$/.test(fragment);
    // A lowercase start is an attribution (`she shrieked`) or a sentence
    // continued inside a quote. Unicode `Ll`, not a Latin range: `à-ỹ` also
    // contains uppercase `Đ` (U+0110) and the uppercase Vietnamese vowels.
    const lowerContinuation = previous !== undefined && /^\p{Ll}/u.test(fragment);
    if (previous !== undefined && (quoteOnly || lowerContinuation)) {
      sentences[sentences.length - 1] = `${previous} ${fragment}`;
    } else {
      sentences.push(fragment);
    }
  }
  return sentences;
}

export function cleanParagraph(value: string): string {
  return value
    .normalize('NFC')
    .replace(/\u00ad/g, '')
    .replace(/\s+/g, ' ')
    .replace(/\s+([,.;:!?])/g, '$1')
    .replace(/([,.;:!?])(?=[A-Za-zÀ-ỹ])/g, '$1 ')
    .trim();
}
