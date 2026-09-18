export type Store = 'apple' | 'google';

export type SortOption = 'newest' | 'helpful' | 'rating';

export type ErrorType =
    'invalid-url' | 'not-found' | 'blocked' | 'rate-limited' | 'timeout' | 'http-error' | 'network' | 'other';

export interface AppTarget {
    /** The raw value the user supplied. */
    input: string;
    store: Store;
    /** Numeric Apple track id or Android package name. */
    appId: string;
    /** Country code found in an App Store URL, if any. */
    countryHint?: string;
}

export interface AppMetadata {
    appName: string | null;
    developer: string | null;
    averageRating: number | null;
    ratingCount: number | null;
    url: string;
}

export interface DeveloperReply {
    text: string;
    date: string | null;
}

export interface Review {
    store: Store;
    appId: string;
    appName: string | null;
    developer: string | null;
    reviewId: string;
    title: string | null;
    text: string;
    rating: number;
    authorName: string | null;
    version: string | null;
    date: string | null;
    helpfulVotes: number;
    developerReply: DeveloperReply | null;
    country: string;
    language: string | null;
    url: string;
    fetchedAt: string;
}

export interface FailureItem {
    success: false;
    input: string;
    store: Store | null;
    appId: string | null;
    errorType: ErrorType;
    error: string;
    fetchedAt: string;
}

export class StoreError extends Error {
    constructor(
        public readonly errorType: ErrorType,
        message: string,
    ) {
        super(message);
        this.name = 'StoreError';
    }
}

/** Maps a thrown error (fetch, got, google-play-scraper) to one of the fixed error categories. */
export function categorizeError(error: unknown): { errorType: ErrorType; message: string } {
    if (error instanceof StoreError) return { errorType: error.errorType, message: error.message };
    const err = error as {
        message?: string;
        status?: number;
        statusCode?: number;
        response?: { statusCode?: number };
        code?: string;
    };
    const message = String(err?.message ?? error).slice(0, 500);
    const status = err?.status ?? err?.statusCode ?? err?.response?.statusCode;
    const m = message.toLowerCase();
    if (status === 404 || m.includes('not found')) return { errorType: 'not-found', message };
    if (status === 429 || m.includes('too many requests')) return { errorType: 'rate-limited', message };
    if (status === 403 || m.includes('blocked') || m.includes('captcha') || m.includes('unusual traffic'))
        return { errorType: 'blocked', message };
    if (status && status >= 400) return { errorType: 'http-error', message };
    if (
        m.includes('timeout') ||
        m.includes('timed out') ||
        err?.code === 'ETIMEDOUT' ||
        err?.code === 'UND_ERR_CONNECT_TIMEOUT'
    )
        return { errorType: 'timeout', message };
    if (
        m.includes('enotfound') ||
        m.includes('econnrefused') ||
        m.includes('econnreset') ||
        m.includes('fetch failed') ||
        m.includes('socket') ||
        m.includes('network')
    )
        return { errorType: 'network', message };
    return { errorType: 'other', message };
}

/** Applies the rating window; ratings outside 1-5 are always dropped. */
export function passesRatingFilter(rating: number, minRating: number, maxRating: number): boolean {
    return Number.isFinite(rating) && rating >= minRating && rating <= maxRating;
}

export function sortReviews(reviews: Review[], sort: SortOption): Review[] {
    const copy = [...reviews];
    if (sort === 'rating') copy.sort((a, b) => b.rating - a.rating || (b.date ?? '').localeCompare(a.date ?? ''));
    else if (sort === 'helpful')
        copy.sort((a, b) => b.helpfulVotes - a.helpfulVotes || (b.date ?? '').localeCompare(a.date ?? ''));
    else copy.sort((a, b) => (b.date ?? '').localeCompare(a.date ?? ''));
    return copy;
}
