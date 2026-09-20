import { describe, it, expect } from 'vitest';
import { inflect, formsFor } from './grammar';

// Long-press word forms. Every expectation here is a card a child could actually see, so a regression
// ("runing", "gos", "childs") is a visible bug, not a style nit.
describe('inflect: plural', () => {
  it('regular nouns', () => {
    expect(inflect('dog', 'plural')).toBe('dogs');
    expect(inflect('box', 'plural')).toBe('boxes');
    expect(inflect('bus', 'plural')).toBe('buses');
    expect(inflect('lunch', 'plural')).toBe('lunches');
    expect(inflect('baby', 'plural')).toBe('babies');
    expect(inflect('toy', 'plural')).toBe('toys');   // vowel + y keeps the y
  });
  it('irregular nouns', () => {
    expect(inflect('child', 'plural')).toBe('children');
    expect(inflect('foot', 'plural')).toBe('feet');
    expect(inflect('leaf', 'plural')).toBe('leaves');
    expect(inflect('tomato', 'plural')).toBe('tomatoes');
  });
  it('returns null when the plural is the same word (nothing to offer)', () => {
    expect(inflect('fish', 'plural')).toBeNull();
    expect(inflect('sheep', 'plural')).toBeNull();
  });
});

describe('inflect: past', () => {
  it('regular verbs, incl. consonant doubling and -y', () => {
    expect(inflect('walk', 'past')).toBe('walked');
    expect(inflect('hug', 'past')).toBe('hugged');
    expect(inflect('stop', 'past')).toBe('stopped');
    expect(inflect('cry', 'past')).toBe('cried');
    expect(inflect('play', 'past')).toBe('played');   // vowel + y: no -ied
    expect(inflect('bake', 'past')).toBe('baked');
    expect(inflect('fix', 'past')).toBe('fixed');     // x never doubles
    expect(inflect('snow', 'past')).toBe('snowed');   // w never doubles
  });
  it('NO_DOUBLE exceptions do not double the final consonant', () => {
    expect(inflect('open', 'past')).toBe('opened');
    expect(inflect('visit', 'past')).toBe('visited');
  });
  it('irregular verbs', () => {
    expect(inflect('go', 'past')).toBe('went');
    expect(inflect('eat', 'past')).toBe('ate');
    expect(inflect('have', 'past')).toBe('had');
    expect(inflect('am', 'past')).toBe('was');
  });
  it('returns null for verbs whose past equals the base form', () => {
    expect(inflect('put', 'past')).toBeNull();
    expect(inflect('hurt', 'past')).toBeNull();
  });
});

describe('inflect: -ing', () => {
  it('regular verbs', () => {
    expect(inflect('run', 'ing')).toBe('running');
    expect(inflect('swim', 'ing')).toBe('swimming');
    expect(inflect('make', 'ing')).toBe('making');    // drops the silent e
    expect(inflect('see', 'ing')).toBe('seeing');     // but not a double e
    expect(inflect('sleep', 'ing')).toBe('sleeping');
    expect(inflect('play', 'ing')).toBe('playing');
    expect(inflect('open', 'ing')).toBe('opening');
  });
  it('irregular -ing', () => {
    expect(inflect('lie', 'ing')).toBe('lying');
    expect(inflect('tie', 'ing')).toBe('tying');
    expect(inflect('be', 'ing')).toBe('being');
    expect(inflect('is', 'ing')).toBe('being');
  });
});

describe('inflect: third person', () => {
  it('regular and irregular', () => {
    expect(inflect('eat', 'third')).toBe('eats');
    expect(inflect('wash', 'third')).toBe('washes');
    expect(inflect('cry', 'third')).toBe('cries');
    expect(inflect('play', 'third')).toBe('plays');
    expect(inflect('go', 'third')).toBe('goes');
    expect(inflect('have', 'third')).toBe('has');
    expect(inflect('do', 'third')).toBe('does');
    expect(inflect('be', 'third')).toBe('is');
  });
  it('modals have no third-person form', () => {
    expect(inflect('can', 'third')).toBeNull();
    expect(inflect('will', 'third')).toBeNull();
  });
});

describe('inflect: possessive', () => {
  it("adds 's, or just an apostrophe after s", () => {
    expect(inflect('dad', 'possessive')).toBe("dad's");
    expect(inflect('James', 'possessive')).toBe("James'");
  });
});

describe('inflect: capitalisation and phrases', () => {
  it('keeps a capitalised base capitalised', () => {
    expect(inflect('Mum', 'plural')).toBe('Mums');
    expect(inflect('Mum', 'possessive')).toBe("Mum's");
    expect(inflect('Go', 'past')).toBe('Went');
  });
  it('inflects the head of a two-word card and keeps the modifier', () => {
    expect(inflect('ice cream', 'plural')).toBe('ice creams');
    expect(inflect('hot dog', 'plural')).toBe('hot dogs');
    expect(inflect('Ice cream', 'possessive')).toBe("Ice cream's");   // the prefix keeps its case, the head is inflected
  });
  it('refuses phrases, numbers and contractions', () => {
    expect(inflect('go to the park', 'past')).toBeNull();
    expect(inflect('3', 'plural')).toBeNull();
    expect(inflect("I'm", 'ing')).toBeNull();
    expect(inflect('   ', 'plural')).toBeNull();
  });
});

describe('formsFor', () => {
  it('offers verb forms for action-like categories and noun forms elsewhere', () => {
    expect(formsFor('actions')).toEqual(['past', 'ing', 'third']);
    expect(formsFor('play')).toEqual(['past', 'ing', 'third']);
    expect(formsFor('people')).toEqual(['plural', 'possessive']);
    expect(formsFor('food')).toEqual(['plural', 'possessive']);
  });
  it('offers nothing for feelings, core and other uninflectable categories', () => {
    expect(formsFor('feelings')).toEqual([]);
    expect(formsFor('core')).toEqual([]);
    expect(formsFor('numbers')).toEqual([]);
  });
});
