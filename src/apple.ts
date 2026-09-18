import { request } from 'node:https';
import { setTimeout as sleep } from 'node:timers/promises';

import { type AppMetadata, type Review, type SortOption, StoreError } from './types.js';

/** Apple's public RSS feed serves at most 10 pages of 50 reviews per country. */
export const APPLE_MAX_PAGES = 10;
export const APPLE_PAGE_SIZE = 50;
export const APPLE_MAX_REVIEWS = APPLE_MAX_PAGES * APPLE_PAGE_SIZE;

const USER_AGENT =
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Safari/605.1.15';

interface Label {
    label?: string;
}

export interface AppleFeedEntry {
    id?: Label;
    title?: Label;
    content?: Label & { attributes?: { type?: string } };
    author?: { name?: Label; uri?: Label };
    updated?: Label;
    'im:rating'?: Label;
    'im:version'?: Label;
    'im:voteSum'?: Label;
    'im:voteCount'?: Label;
}

export interface AppleFeed {
    feed?: {
        entry?: AppleFeedEntry | AppleFeedEntry[];
    };
}

/**
 * The feed exists as /json and /xml. The JSON serialisation intermittently returns an empty page
 * (observed on 3 of 10 pages for a popular app while the XML page had all 50 entries), so the
 * XML variant is used and parsed into the same entry shape.
 */
export function appleFeedUrl(
    appId: string,
    country: string,
    page: number,
    sort: SortOption,
    format: 'xml' | 'json' = 'xml',
): string {
    const sortBy = sort === 'helpful' ? 'mosthelpful' : 'mostrecent';
    return `https://itunes.apple.com/${country}/rss/customerreviews/page=${page}/id=${appId}/sortby=${sortBy}/${format}`;
}

export function appleLookupUrl(appId: string, country: string): string {
    return `https://itunes.apple.com/lookup?id=${appId}&country=${country}`;
}

export function appleReviewsPageUrl(appId: string, country: string): string {
    return `https://apps.apple.com/${country}/app/id${appId}?see-all=reviews`;
}

const XML_ENTITIES: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" };

export function decodeXmlEntities(value: string): string {
    return value.replace(/&(#x[0-9a-fA-F]+|#\d+|[a-zA-Z]+);/g, (whole, code: string) => {
        if (code.startsWith('#x')) return String.fromCodePoint(Number.parseInt(code.slice(2), 16));
        if (code.startsWith('#')) return String.fromCodePoint(Number.parseInt(code.slice(1), 10));
        return XML_ENTITIES[code] ?? whole;
    });
}

/** Returns the decoded text of the first `<tag ...>...</tag>` element; `attr` narrows to an opening tag containing it. */
function xmlTag(entry: string, tag: string, attr = ''): string | undefined {
    let from = 0;
    while (from < entry.length) {
        const open = entry.indexOf(`<${tag}`, from);
        if (open === -1) return undefined;
        const openEnd = entry.indexOf('>', open);
        if (openEnd === -1) return undefined;
        const openTag = entry.slice(open, openEnd + 1);
        const nextChar = entry[open + tag.length + 1];
        const isExactTag = nextChar === '>' || nextChar === ' ' || nextChar === '/';
        if (isExactTag && openTag.includes(attr)) {
            if (openTag.endsWith('/>')) return '';
            const close = entry.indexOf(`</${tag}>`, openEnd + 1);
            if (close === -1) return undefined;
            return decodeXmlEntities(entry.slice(openEnd + 1, close));
        }
        from = openEnd + 1;
    }
    return undefined;
}

/** Parses the Atom XML variant of the feed into the same entry objects the JSON variant uses. */
export function parseAppleXml(xml: string): AppleFeedEntry[] {
    if (!xml.includes('<feed')) throw new StoreError('other', 'Apple feed response is not an Atom feed.');
    const entries: AppleFeedEntry[] = [];
    for (const m of xml.matchAll(/<entry>([\s\S]*?)<\/entry>/g)) {
        const e = m[1];
        const authorBlock = e.match(/<author>([\s\S]*?)<\/author>/)?.[1] ?? '';
        entries.push({
            id: { label: xmlTag(e, 'id') },
            title: { label: xmlTag(e, 'title') },
            content: { label: xmlTag(e, 'content', 'type="text"'), attributes: { type: 'text' } },
            author: { name: { label: xmlTag(authorBlock, 'name') }, uri: { label: xmlTag(authorBlock, 'uri') } },
            updated: { label: xmlTag(e, 'updated') },
            'im:rating': { label: xmlTag(e, 'im:rating') },
            'im:version': { label: xmlTag(e, 'im:version') },
            'im:voteSum': { label: xmlTag(e, 'im:voteSum') },
            'im:voteCount': { label: xmlTag(e, 'im:voteCount') },
        });
    }
    return entries;
}

/** Returns the entries of a feed page as an array (Apple returns a bare object when there is exactly one). */
export function appleFeedEntries(feed: AppleFeed): AppleFeedEntry[] {
    const entry = feed?.feed?.entry;
    if (!entry) return [];
    return Array.isArray(entry) ? entry : [entry];
}

function toInt(value: string | undefined): number {
    const n = Number.parseInt(value ?? '', 10);
    return Number.isFinite(n) ? n : 0;
}

function toIsoDate(value: string | undefined): string | null {
    if (!value) return null;
    const d = new Date(value);
    return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

/** Converts one RSS entry to the unified review shape. Returns null for entries without an id (feed metadata). */
export function parseAppleEntry(
    entry: AppleFeedEntry,
    ctx: { appId: string; country: string; meta: AppMetadata; fetchedAt: string },
): Review | null {
    const reviewId = entry.id?.label?.trim();
    const rating = toInt(entry['im:rating']?.label);
    if (!reviewId || rating < 1) return null;
    return {
        store: 'apple',
        appId: ctx.appId,
        appName: ctx.meta.appName,
        developer: ctx.meta.developer,
        reviewId,
        title: entry.title?.label?.trim() || null,
        text: entry.content?.label?.trim() ?? '',
        rating,
        authorName: entry.author?.name?.label?.trim() || null,
        version: entry['im:version']?.label?.trim() || null,
        date: toIsoDate(entry.updated?.label),
        helpfulVotes: toInt(entry['im:voteSum']?.label),
        developerReply: null,
        country: ctx.country,
        language: null,
        url: appleReviewsPageUrl(ctx.appId, ctx.country),
        fetchedAt: ctx.fetchedAt,
    };
}

/**
 * Minimal GET over node:https pinned to IPv4. Node's global fetch (undici) tries the AAAA records of
 * itunes.apple.com first and fails outright in containers without an IPv6 route (ENETUNREACH), so
 * the connection family is fixed to IPv4, which every Apple endpoint serves.
 */
async function fetchText(url: string, timeoutMs: number, accept: string, redirects = 0): Promise<string> {
    const { status, body, location } = await new Promise<{ status: number; body: string; location?: string }>(
        (resolve, reject) => {
            const req = request(
                url,
                { method: 'GET', family: 4, headers: { 'user-agent': USER_AGENT, accept }, timeout: timeoutMs },
                (res) => {
                    const chunks: Buffer[] = [];
                    res.on('data', (chunk: Buffer) => chunks.push(chunk));
                    res.on('end', () =>
                        resolve({
                            status: res.statusCode ?? 0,
                            body: Buffer.concat(chunks).toString('utf8'),
                            location: res.headers.location,
                        }),
                    );
                    res.on('error', reject);
                },
            );
            req.on('timeout', () => req.destroy(new Error(`Request to ${url} timed out after ${timeoutMs} ms`)));
            req.on('error', reject);
            req.end();
        },
    );
    if (status >= 300 && status < 400 && location) {
        if (redirects >= 3) throw new StoreError('http-error', `Too many redirects for ${url}`);
        return fetchText(new URL(location, url).toString(), timeoutMs, accept, redirects + 1);
    }
    if (status === 429) throw new StoreError('rate-limited', `Apple returned HTTP 429 for ${url}`);
    if (status === 403) throw new StoreError('blocked', `Apple returned HTTP 403 for ${url}`);
    if (status === 404) throw new StoreError('not-found', `Apple returned HTTP 404 for ${url}`);
    if (status < 200 || status >= 300) throw new StoreError('http-error', `Apple returned HTTP ${status} for ${url}`);
    return body;
}

async function fetchJson(url: string, timeoutMs: number): Promise<unknown> {
    const text = await fetchText(url, timeoutMs, 'application/json');
    try {
        return JSON.parse(text);
    } catch {
        throw new StoreError('other', `Apple returned a non-JSON response for ${url}`);
    }
}

interface LookupResponse {
    resultCount?: number;
    results?: {
        trackName?: string;
        artistName?: string;
        averageUserRating?: number;
        userRatingCount?: number;
        trackViewUrl?: string;
    }[];
}

export function parseAppleLookup(json: unknown, appId: string, country: string): AppMetadata | null {
    const data = json as LookupResponse;
    const app = data?.results?.[0];
    if (!data || !Array.isArray(data.results) || !app) return null;
    return {
        appName: app.trackName ?? null,
        developer: app.artistName ?? null,
        averageRating: typeof app.averageUserRating === 'number' ? Math.round(app.averageUserRating * 100) / 100 : null,
        ratingCount: typeof app.userRatingCount === 'number' ? app.userRatingCount : null,
        url: app.trackViewUrl?.replace(/\?uo=\d+$/, '') ?? appleReviewsPageUrl(appId, country),
    };
}

export interface AppleFetchOptions {
    appId: string;
    country: string;
    sort: SortOption;
    /** Upper bound on raw reviews to download (before rating filtering). */
    maxReviews: number;
    timeoutMs?: number;
    delayMs?: number;
    /** Called after every page; return false to stop early (e.g. enough matching reviews collected). */
    onPage?: (reviews: Review[], page: number) => Promise<boolean> | boolean;
}

export async function fetchAppleMetadata(appId: string, country: string, timeoutMs = 30_000): Promise<AppMetadata> {
    const json = await fetchJson(appleLookupUrl(appId, country), timeoutMs);
    const meta = parseAppleLookup(json, appId, country);
    if (!meta) throw new StoreError('not-found', `No app with id ${appId} exists in the "${country}" App Store.`);
    return meta;
}

/**
 * Downloads review pages from the public RSS feed until `maxReviews` raw reviews were seen,
 * the feed runs out, or `onPage` returns false. Returns the total number of raw reviews seen.
 */
export async function fetchAppleReviews(
    opts: AppleFetchOptions,
    meta: AppMetadata,
): Promise<{ raw: number; pages: number }> {
    const timeoutMs = opts.timeoutMs ?? 30_000;
    const delayMs = opts.delayMs ?? 300;
    const seen = new Set<string>();
    let raw = 0;
    let pages = 0;
    for (let page = 1; page <= APPLE_MAX_PAGES && raw < opts.maxReviews; page += 1) {
        if (page > 1) await sleep(delayMs);
        const xml = await fetchText(
            appleFeedUrl(opts.appId, opts.country, page, opts.sort),
            timeoutMs,
            'application/atom+xml, application/xml, text/xml',
        );
        const entries = parseAppleXml(xml);
        pages += 1;
        const fetchedAt = new Date().toISOString();
        const reviews: Review[] = [];
        for (const entry of entries) {
            const review = parseAppleEntry(entry, { appId: opts.appId, country: opts.country, meta, fetchedAt });
            if (!review || seen.has(review.reviewId)) continue;
            seen.add(review.reviewId);
            reviews.push(review);
        }
        if (reviews.length === 0) break;
        raw += reviews.length;
        if (opts.onPage && (await opts.onPage(reviews, page)) === false) break;
        if (reviews.length < APPLE_PAGE_SIZE) break;
    }
    return { raw, pages };
}
