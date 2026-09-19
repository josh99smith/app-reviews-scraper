import type { AppTarget } from './types.js';

const APPLE_ID_RE = /^\d{6,12}$/;
const ANDROID_PACKAGE_RE = /^[a-zA-Z][a-zA-Z0-9_]*(\.[a-zA-Z][a-zA-Z0-9_]*)+$/;

/**
 * Detects the store and app id from a user-supplied value. Accepts:
 * - App Store URLs: https://apps.apple.com/us/app/spotify/id324684580, https://itunes.apple.com/app/id324684580
 * - Google Play URLs: https://play.google.com/store/apps/details?id=com.spotify.music
 * - bare numeric Apple ids (324684580) and Android package names (com.spotify.music)
 * Returns null when the value cannot be interpreted.
 */
export function identifyApp(raw: string): AppTarget | null {
    const input = (raw ?? '').trim();
    if (!input) return null;

    if (APPLE_ID_RE.test(input)) return { input, store: 'apple', appId: input };
    // "id324684580" as it appears at the end of App Store URLs, with or without the "id" prefix.
    const prefixed = /^id(\d{6,12})$/i.exec(input);
    if (prefixed) return { input, store: 'apple', appId: prefixed[1] };
    if (ANDROID_PACKAGE_RE.test(input)) return { input, store: 'google', appId: input };

    let url: URL;
    try {
        url = new URL(/^https?:\/\//i.test(input) ? input : `https://${input}`);
    } catch {
        return null;
    }
    const host = url.hostname.toLowerCase();

    if (host === 'play.google.com' || host.endsWith('.play.google.com')) {
        const id = url.searchParams.get('id')?.trim();
        if (id && ANDROID_PACKAGE_RE.test(id)) return { input, store: 'google', appId: id };
        return null;
    }

    if (host.endsWith('apple.com')) {
        const match = url.pathname.match(/\/id(\d{6,12})(?:[/?#]|$)/);
        if (!match) return null;
        const country = url.pathname.match(/^\/([a-z]{2})\//i)?.[1]?.toLowerCase();
        return { input, store: 'apple', appId: match[1], countryHint: country };
    }

    return null;
}

/** Normalises an ISO 3166-1 alpha-2 country code; returns null when it is not two letters. */
export function normalizeCountry(value: string | undefined, fallback = 'us'): string | null {
    const v = (value ?? fallback).trim().toLowerCase();
    return /^[a-z]{2}$/.test(v) ? v : null;
}

/** Normalises a language code such as `en`, `en-US` or `pt_BR` to lowercase BCP-47-ish form. */
export function normalizeLanguage(value: string | undefined, fallback = 'en'): string | null {
    const v = (value ?? fallback).trim().replace('_', '-');
    return /^[a-zA-Z]{2,3}(-[a-zA-Z0-9]{2,8})?$/.test(v) ? v.toLowerCase() : null;
}
