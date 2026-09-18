import { setTimeout as sleep } from 'node:timers/promises';

import gplay, { type IReviewsItem } from 'google-play-scraper';

import { type AppMetadata, type Review, type SortOption, StoreError } from './types.js';

/**
 * The Play batchexecute endpoint always serves 150 reviews per call and the pagination token
 * advances by 150 regardless of `num`, so smaller page sizes silently skip reviews.
 */
export const GOOGLE_PAGE_SIZE = 150;

/** Passed through to got: pin DNS to IPv4 so containers without an IPv6 route do not fail on AAAA records. */
const REQUEST_OPTIONS = { dnsLookupIpVersion: 'ipv4' as const };

// The type definitions expose `sort` as an enum type only; the runtime object carries the values.
const gplaySort = gplay.sort as unknown as Record<'NEWEST' | 'RATING' | 'HELPFULNESS', number>;
const SORT_MAP: Record<SortOption, number> = {
    newest: gplaySort.NEWEST,
    helpful: gplaySort.HELPFULNESS,
    rating: gplaySort.RATING,
};

export function googleReviewUrl(appId: string, reviewId: string): string {
    return `https://play.google.com/store/apps/details?id=${encodeURIComponent(appId)}&reviewId=${encodeURIComponent(reviewId)}`;
}

export function googleAppUrl(appId: string, language: string, country: string): string {
    return `https://play.google.com/store/apps/details?id=${encodeURIComponent(appId)}&hl=${language}&gl=${country}`;
}

function toIsoDate(value: unknown): string | null {
    if (!value) return null;
    const d = new Date(value as string);
    return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

/** Converts a google-play-scraper review item to the unified shape. Returns null for malformed items. */
export function mapGoogleReview(
    item: Partial<IReviewsItem>,
    ctx: { appId: string; country: string; language: string; meta: AppMetadata; fetchedAt: string },
): Review | null {
    const reviewId = typeof item.id === 'string' ? item.id.trim() : '';
    const rating = Number(item.score);
    if (!reviewId || !Number.isFinite(rating) || rating < 1) return null;
    const replyText = typeof item.replyText === 'string' ? item.replyText.trim() : '';
    return {
        store: 'google',
        appId: ctx.appId,
        appName: ctx.meta.appName,
        developer: ctx.meta.developer,
        reviewId,
        title: typeof item.title === 'string' && item.title.trim() ? item.title.trim() : null,
        text: typeof item.text === 'string' ? item.text.trim() : '',
        rating,
        authorName: typeof item.userName === 'string' && item.userName.trim() ? item.userName.trim() : null,
        version: typeof item.version === 'string' && item.version ? item.version : null,
        date: toIsoDate(item.date),
        helpfulVotes: Number.isFinite(Number(item.thumbsUp)) ? Number(item.thumbsUp) : 0,
        developerReply: replyText ? { text: replyText, date: toIsoDate(item.replyDate) } : null,
        country: ctx.country,
        language: ctx.language,
        url: googleReviewUrl(ctx.appId, reviewId),
        fetchedAt: ctx.fetchedAt,
    };
}

export interface GoogleFetchOptions {
    appId: string;
    country: string;
    language: string;
    sort: SortOption;
    maxReviews: number;
    timeoutMs?: number;
    delayMs?: number;
    onPage?: (reviews: Review[], page: number) => Promise<boolean> | boolean;
}

export async function fetchGoogleMetadata(
    appId: string,
    country: string,
    language: string,
    timeoutMs = 30_000,
): Promise<AppMetadata> {
    const app = await gplay.app({
        appId,
        country,
        lang: language,
        requestOptions: { ...REQUEST_OPTIONS, timeout: timeoutMs },
    } as Parameters<typeof gplay.app>[0]);
    if (!app || typeof app !== 'object' || !app.appId)
        throw new StoreError('other', `Google Play returned an unexpected response for ${appId}.`);
    return {
        appName: app.title ?? null,
        developer: app.developer ?? null,
        averageRating: typeof app.score === 'number' ? Math.round(app.score * 100) / 100 : null,
        ratingCount: typeof app.ratings === 'number' ? app.ratings : null,
        url: app.url ?? googleAppUrl(appId, language, country),
    };
}

/**
 * Pages through Play reviews via google-play-scraper's pagination tokens until `maxReviews` raw
 * reviews were seen, the store runs out, or `onPage` returns false.
 */
export async function fetchGoogleReviews(
    opts: GoogleFetchOptions,
    meta: AppMetadata,
): Promise<{ raw: number; pages: number }> {
    const timeoutMs = opts.timeoutMs ?? 30_000;
    const delayMs = opts.delayMs ?? 400;
    const seen = new Set<string>();
    let token: string | undefined;
    let raw = 0;
    let pages = 0;
    while (raw < opts.maxReviews) {
        if (pages > 0) await sleep(delayMs);
        const result = await gplay.reviews({
            appId: opts.appId,
            country: opts.country,
            lang: opts.language,
            sort: SORT_MAP[opts.sort],
            num: GOOGLE_PAGE_SIZE,
            paginate: true,
            nextPaginationToken: token,
            requestOptions: { ...REQUEST_OPTIONS, timeout: timeoutMs },
        } as Parameters<typeof gplay.reviews>[0]);
        if (!result || !Array.isArray(result.data))
            throw new StoreError('other', `Google Play returned an unexpected reviews payload for ${opts.appId}.`);
        pages += 1;
        const fetchedAt = new Date().toISOString();
        const reviews: Review[] = [];
        for (const item of result.data) {
            const review = mapGoogleReview(item, {
                appId: opts.appId,
                country: opts.country,
                language: opts.language,
                meta,
                fetchedAt,
            });
            if (!review || seen.has(review.reviewId)) continue;
            seen.add(review.reviewId);
            reviews.push(review);
        }
        if (reviews.length === 0) break;
        raw += reviews.length;
        if (opts.onPage && (await opts.onPage(reviews, pages)) === false) break;
        token = result.nextPaginationToken ?? undefined;
        if (!token) break;
    }
    return { raw, pages };
}
