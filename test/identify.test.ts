import { describe, expect, it } from 'vitest';

import { identifyApp, normalizeCountry, normalizeLanguage } from '../src/identify.js';

describe('identifyApp', () => {
    it('accepts an id-prefixed Apple id', () => {
        expect(identifyApp('id284882215')).toMatchObject({ store: 'apple', appId: '284882215' });
        expect(identifyApp('ID284882215')).toMatchObject({ store: 'apple', appId: '284882215' });
    });

    it('detects App Store URLs with a country', () => {
        const t = identifyApp('https://apps.apple.com/us/app/spotify-music-and-podcasts/id324684580');
        expect(t).toEqual({
            input: 'https://apps.apple.com/us/app/spotify-music-and-podcasts/id324684580',
            store: 'apple',
            appId: '324684580',
            countryHint: 'us',
        });
    });

    it('detects App Store URLs without a country and legacy itunes links', () => {
        expect(identifyApp('https://apps.apple.com/app/id324684580?see-all=reviews')?.appId).toBe('324684580');
        expect(identifyApp('https://apps.apple.com/app/id324684580')?.countryHint).toBeUndefined();
        expect(identifyApp('itunes.apple.com/gb/app/facebook/id284882215?mt=8')).toMatchObject({
            store: 'apple',
            appId: '284882215',
            countryHint: 'gb',
        });
    });

    it('detects Google Play URLs', () => {
        expect(
            identifyApp('https://play.google.com/store/apps/details?id=com.spotify.music&hl=en&gl=US'),
        ).toMatchObject({
            store: 'google',
            appId: 'com.spotify.music',
        });
    });

    it('detects bare identifiers', () => {
        expect(identifyApp('324684580')).toMatchObject({ store: 'apple', appId: '324684580' });
        expect(identifyApp('  com.spotify.music ')).toMatchObject({ store: 'google', appId: 'com.spotify.music' });
        expect(identifyApp('com.example.my_app2')).toMatchObject({ store: 'google' });
    });

    it('rejects values that are neither', () => {
        expect(identifyApp('')).toBeNull();
        expect(identifyApp('not an app')).toBeNull();
        expect(identifyApp('https://example.com/app/id123456')).toBeNull();
        expect(identifyApp('https://play.google.com/store/apps/details')).toBeNull();
        expect(identifyApp('https://apps.apple.com/us/app/spotify')).toBeNull();
        expect(identifyApp('12')).toBeNull();
    });
});

describe('normalizeCountry / normalizeLanguage', () => {
    it('lowercases valid codes and rejects invalid ones', () => {
        expect(normalizeCountry('US')).toBe('us');
        expect(normalizeCountry(undefined)).toBe('us');
        expect(normalizeCountry('usa')).toBeNull();
        expect(normalizeLanguage('pt_BR')).toBe('pt-br');
        expect(normalizeLanguage(undefined)).toBe('en');
        expect(normalizeLanguage('english language')).toBeNull();
    });
});
