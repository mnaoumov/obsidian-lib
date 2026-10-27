// Cspell:words xfoo foox Мирный Ιota straße congruential

/* eslint-disable unicorn/prefer-code-point -- The code under test reads UTF-16 code units, as Obsidian's regex does. */
import {
  describe,
  expect,
  it
} from 'vitest';

import {
  canonicalizeObsidianText,
  createObsidianMentionRegExp,
  getObsidianNameTokens,
  isObsidianWordCharacter,
  tokenizeObsidianWords
} from './obsidian-word-characters.ts';

/*
 * Characters chosen to stress the case folding a non-Unicode `i` regex does: `ß` (upper case is two code units), `ı`
 * and `ſ` (fold to ASCII, which the regex refuses), the Kelvin sign (upper case already, never folded to `K`), `µ`
 * (folds to Greek Mu), the combining iota `ͅ` (not a word character, yet folds to the word character `Ι`), CJK,
 * a combining accent, and separators.
 */
const ALPHABET = ['a', 'A', 'b', 'k', 'K', 'K', 's', 'S', 'ſ', 'ß', 'ẞ', 'i', 'I', 'ı', 'µ', 'Μ', 'ͅ', 'Ι', 'é', '́', 'я', 'Я', '日', '1', '_', ' ', '-', '.', '['];

describe('canonicalizeObsidianText', () => {
  it('should preserve length and distinguish the non-Unicode regex exceptions', () => {
    expect(canonicalizeObsidianText('σςΣ kK sſ ıi ßẞ éÉ 😀')).toBe('ΣΣΣ KK Sſ ıI ßẞ ÉÉ 😀');
    expect(canonicalizeObsidianText('')).toBe('');
  });

  it('should agree with native ignore-case regex matching for every UTF-16 code unit', () => {
    const mismatches: number[] = [];
    for (let code = 0; code < 65_536; code++) {
      const text = String.fromCharCode(code);
      const folded = canonicalizeObsidianText(text);
      const regex = new RegExp(String.raw`^\u${code.toString(16).padStart(4, '0')}$`, 'i');
      if (folded.length !== 1 || !regex.test(folded) || canonicalizeObsidianText(folded) !== folded) {
        mismatches.push(code);
      }
    }
    expect(mismatches).toEqual([]);
  });
});

describe('createObsidianMentionRegExp', () => {
  it('should match a name that starts and ends with a word character only as a whole word', () => {
    expect(findAll('Foo', 'Foo, foo! xfoo foox FOO')).toEqual([[0, 3], [5, 8], [20, 23]]);
  });

  it('should match a name that starts or ends with a non-word character anywhere on that side', () => {
    expect(findAll('#tag', 'x#tag #tagged')).toEqual([[1, 5]]);
    expect(findAll('C++', 'C++x aC++')).toEqual([[0, 3]]);
  });

  it('should treat Cyrillic letters as word characters and CJK ideographs as not', () => {
    expect(findAll('Мир', 'Мирный мир')).toEqual([[7, 10]]);
    expect(findAll('東京', '東京タワー')).toEqual([[0, 2]]);
  });

  it('should escape the characters a regular expression would read', () => {
    expect(findAll('a.b (c)', 'axb (c) a.b (c)')).toEqual([[8, 15]]);
  });

  it('should match at the start of the file but not after a newline that is not a separator', () => {
    expect(findAll('Foo', 'Foo\nFoo')).toEqual([[0, 3], [4, 7]]);
  });
});

describe('getObsidianNameTokens', () => {
  it('should split a name into canonical word tokens', () => {
    expect(getObsidianNameTokens('Hello, World-2')).toEqual(['HELLO', 'WORLD', '2']);
  });

  it('should refuse a name with no word character', () => {
    expect(getObsidianNameTokens('東京')).toBeNull();
    expect(getObsidianNameTokens('---')).toBeNull();
  });

  it('should refuse a name holding a character whose case folding crosses word-ness', () => {
    expect(getObsidianNameTokens('Ιota')).toBeNull();
  });
});

describe('isObsidianWordCharacter', () => {
  it('should follow Obsidian\'s class', () => {
    expect(isObsidianWordCharacter('a'.charCodeAt(0))).toBe(true);
    expect(isObsidianWordCharacter('9'.charCodeAt(0))).toBe(true);
    expect(isObsidianWordCharacter('_'.charCodeAt(0))).toBe(false);
    expect(isObsidianWordCharacter('日'.charCodeAt(0))).toBe(false);
    expect(isObsidianWordCharacter(NaN)).toBe(false);
  });
});

describe('tokenizeObsidianWords', () => {
  it('should fold case the way the regular expression does', () => {
    expect(tokenizeObsidianWords('straße ıi ſ K k µ')).toEqual(['STRAßE', 'ıI', 'ſ', 'K', 'K', 'Μ']);
  });

  it('should keep a run longer than a function call can take as arguments in one token', () => {
    const long = 'ß'.repeat(200_000);

    expect(tokenizeObsidianWords(` ${long} `)).toEqual([long]);
  });

  it('should find every name the regular expression matches as consecutive whole tokens', () => {
    const random = createRandom(1);
    function randomText(length: number): string {
      return Array.from({ length }, () => ALPHABET[random(ALPHABET.length)]).join('');
    }

    let checkedMatchCount = 0;
    for (let iteration = 0; iteration < 3000; iteration++) {
      const name = randomText(1 + random(4));
      const nameTokens = getObsidianNameTokens(name);
      if (nameTokens === null) {
        continue;
      }

      const text = randomText(random(40));
      const regExp = createObsidianMentionRegExp(name);
      for (let match = regExp.exec(text); match; match = regExp.exec(text)) {
        const end = regExp.lastIndex;
        const start = end - (match[1]?.length ?? 0);
        // The tokens of the text up to the match end, minus those before it, are the match's own.
        const textTokens = tokenizeObsidianWords(text);
        const tokensBefore = tokenizeObsidianWords(text.slice(0, start)).length;
        expect(textTokens.slice(tokensBefore, tokensBefore + nameTokens.length), `${JSON.stringify(name)} in ${JSON.stringify(text)}`).toEqual(nameTokens);
        checkedMatchCount++;
      }
    }

    expect(checkedMatchCount).toBeGreaterThan(100);
  });
});

// A fixed-seed linear congruential generator, so a failure reproduces.
function createRandom(initialSeed: number): (limit: number) => number {
  let seed = initialSeed;
  return (limit: number): number => {
    seed = (seed * 1_103_515_245 + 12_345) % 2_147_483_648;
    return seed % limit;
  };
}

function findAll(name: string, text: string): [number, number][] {
  const regExp = createObsidianMentionRegExp(name);
  const ranges: [number, number][] = [];
  for (let match = regExp.exec(text); match; match = regExp.exec(text)) {
    ranges.push([regExp.lastIndex - (match[1]?.length ?? 0), regExp.lastIndex]);
  }

  return ranges;
}

/* eslint-enable unicorn/prefer-code-point -- End of the file. */
