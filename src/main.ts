import { setTimeout as sleep } from 'node:timers/promises';

import { Actor, log } from 'apify';

import { APPLE_MAX_REVIEWS, fetchAppleMetadata, fetchAppleReviews } from './apple.js';
import { fetchGoogleMetadata, fetchGoogleReviews } from './google.js';
import { identifyApp, normalizeCountry, normalizeLanguage } from './identify.js';
import {
    type AppMetadata,
    type AppTarget,
    categorizeError,
    type FailureItem,
    passesRatingFilter,
    type Review,
    type SortOption,
    sortReviews,
} from './types.js';

const CHARGE_EVENT = 'review';
const SORT_OPTIONS: SortOption[] = ['newest', 'helpful', 'rating'];
/** Polite fixed concurrency: at most this many apps are processed at once (Play tolerates about 3). */
const MAX_CONCURRENCY = 3;

interface Input {
    apps?: (string | { url?: string; appId?: string })[];
    country?: string;
    language?: string;
    sort?: SortOption;
    maxReviewsPerApp?: number;
    minRating?: number;
    maxRating?: number;
    timeoutSecs?: number;
}

interface AppSummary {
    input: string;
    store: AppTarget['store'];
    appId: string;
    appName: string | null;
    developer: string | null;
    averageRating: number | null;
    ratingCount: number | null;
    reviewsFetched: number;
    reviewsPushed: number;
    url: string;
}

function clampInt(value: unknown, fallback: number, min: number, max: number): number {
    const n = typeof value === 'number' && Number.isFinite(value) ? Math.trunc(value) : fallback;
    return Math.min(Math.max(n, min), max);
}

await Actor.init();

let aborting = false;
Actor.on('aborting', async () => {
    aborting = true;
    await sleep(1000);
    await Actor.exit();
});

const input = (await Actor.getInput<Input>()) ?? {};

const rawApps = (input.apps ?? [])
    .map((a) => (typeof a === 'string' ? a : (a?.url ?? a?.appId ?? '')))
    .filter((a) => typeof a === 'string');
if (rawApps.length === 0) {
    await Actor.fail(
        'Input "apps" is empty. Provide at least one App Store URL, Google Play URL, Apple app id or Android package name.',
    );
}
const country = normalizeCountry(input.country);
if (!country)
    await Actor.fail(
        `Input "country" must be a two-letter country code such as "us" or "gb" (got "${input.country}").`,
    );
const language = normalizeLanguage(input.language);
if (!language)
    await Actor.fail(`Input "language" must be a language code such as "en" or "pt-BR" (got "${input.language}").`);
const sort: SortOption = SORT_OPTIONS.includes(input.sort as SortOption) ? (input.sort as SortOption) : 'newest';
const maxReviewsPerApp = clampInt(input.maxReviewsPerApp, 200, 1, 10_000);
const minRating = clampInt(input.minRating, 1, 1, 5);
const maxRating = clampInt(input.maxRating, 5, 1, 5);
if (minRating > maxRating)
    await Actor.fail(`Input "minRating" (${minRating}) must not be greater than "maxRating" (${maxRating}).`);
const timeoutMs = clampInt(input.timeoutSecs, 30, 5, 120) * 1000;

// Validate identifiers up front; invalid ones are reported as free failure records.
const targets: AppTarget[] = [];
const failures: FailureItem[] = [];
const seenTargets = new Set<string>();
for (const raw of rawApps) {
    const target = identifyApp(raw);
    if (!target) {
        failures.push({
            success: false,
            input: raw,
            store: null,
            appId: null,
            errorType: 'invalid-url',
            error: 'Not an App Store URL, Google Play URL, Apple app id or Android package name.',
            fetchedAt: new Date().toISOString(),
        });
        continue;
    }
    const key = `${target.store}:${target.appId}`;
    if (seenTargets.has(key)) continue;
    seenTargets.add(key);
    targets.push(target);
}
if (failures.length) await Actor.pushData(failures);

const { isPayPerEvent } = Actor.getChargingManager().getPricingInfo();
log.info(
    `Collecting up to ${maxReviewsPerApp} ${sort} reviews (rating ${minRating}-${maxRating}) for ${targets.length} app(s) in country "${country}", language "${language}".`,
);
if (sort === 'rating' && targets.some((t) => t.store === 'apple')) {
    log.info(
        'Apple feeds only support "newest" and "helpful" ordering; Apple results for sort="rating" are ordered by rating after download.',
    );
}

let reviewsCharged = 0;
let reviewsFetched = 0;
let stopBecauseOfBudget = false;
const appSummaries: AppSummary[] = [];

async function pushReviews(reviews: Review[]): Promise<number> {
    if (reviews.length === 0 || stopBecauseOfBudget) return 0;
    // Ask the budget how many events still fit, push only that many, and count exactly what was pushed.
    // (The SDK's returned chargedCount over-reports on the platform, so it is not used for counting.)
    const allowed = isPayPerEvent ? Actor.getChargingManager().calculateMaxEventChargeCountWithinLimit(CHARGE_EVENT) : reviews.length;
    const batch = reviews.slice(0, Math.max(0, allowed));
    let eventChargeLimitReached = batch.length < reviews.length;
    if (batch.length > 0) {
        const result = await Actor.pushData(batch, CHARGE_EVENT);
        eventChargeLimitReached = eventChargeLimitReached || result.eventChargeLimitReached;
    }
    const pushed = batch.length;
    reviewsCharged += pushed;
    if (eventChargeLimitReached) {
        stopBecauseOfBudget = true;
        log.warning(
            'Maximum charge limit for this run reached; stopping early. Raise the run cost limit to collect more reviews.',
        );
    }
    return pushed;
}

function summarize(
    target: AppTarget,
    meta: AppMetadata,
    reviewsFetchedForApp: number,
    reviewsPushed: number,
): AppSummary {
    return {
        input: target.input,
        store: target.store,
        appId: target.appId,
        appName: meta.appName,
        developer: meta.developer,
        averageRating: meta.averageRating,
        ratingCount: meta.ratingCount,
        reviewsFetched: reviewsFetchedForApp,
        reviewsPushed,
        url: meta.url,
    };
}

async function processTarget(target: AppTarget): Promise<void> {
    const started = Date.now();
    const appCountry = target.countryHint ?? country!;
    const label = `${target.store}:${target.appId}`;
    let meta: AppMetadata | undefined;
    let pushedForApp = 0;
    let rawForApp = 0;
    const buffer: Review[] = [];
    try {
        meta =
            target.store === 'apple'
                ? await fetchAppleMetadata(target.appId, appCountry, timeoutMs)
                : await fetchGoogleMetadata(target.appId, appCountry, language!, timeoutMs);
        if (target.store === 'apple' && maxReviewsPerApp > APPLE_MAX_REVIEWS) {
            log.info(
                `${label}: the public App Store feed exposes at most ${APPLE_MAX_REVIEWS} reviews per country; capping.`,
            );
        }
        const wanted = target.store === 'apple' ? Math.min(maxReviewsPerApp, APPLE_MAX_REVIEWS) : maxReviewsPerApp;
        const filterActive = minRating > 1 || maxRating < 5;
        // The Apple feed cannot sort by rating, so in that mode every available review (<= 500) is
        // downloaded, sorted by rating and only then are the top `wanted` pushed. Play's native rating
        // order is highest-first, which never reaches low ratings, so when the window excludes 5-star
        // reviews the newest reviews are paged instead and sorted locally.
        const bufferAll = sort === 'rating' && (target.store === 'apple' || maxRating < 5);
        const fetchSort: SortOption = bufferAll && target.store === 'google' ? 'newest' : sort;
        // Without a rating filter each page is pushed as it arrives. With a filter more pages than
        // `wanted` reviews may be needed, so the raw cap is raised and paging stops once enough matched.
        const onPage = async (pageReviews: Review[]): Promise<boolean> => {
            if (aborting) return false;
            const matching = pageReviews.filter((r) => passesRatingFilter(r.rating, minRating, maxRating));
            if (bufferAll) {
                buffer.push(...matching);
                return true;
            }
            const take = matching.slice(0, Math.max(wanted - pushedForApp, 0));
            pushedForApp += await pushReviews(take);
            return !stopBecauseOfBudget && pushedForApp < wanted;
        };
        const common = { appId: target.appId, country: appCountry, sort: fetchSort, timeoutMs, onPage };
        let maxRaw = wanted;
        if (filterActive || bufferAll) maxRaw = target.store === 'apple' ? APPLE_MAX_REVIEWS : wanted * 10;
        const result =
            target.store === 'apple'
                ? await fetchAppleReviews({ ...common, maxReviews: maxRaw }, meta)
                : await fetchGoogleReviews({ ...common, language: language!, maxReviews: maxRaw }, meta);
        rawForApp = result.raw;
        if (buffer.length) pushedForApp += await pushReviews(sortReviews(buffer, sort).slice(0, wanted));
        reviewsFetched += rawForApp;
        appSummaries.push(summarize(target, meta, rawForApp, pushedForApp));
        log.info(
            `${label} (${meta.appName ?? 'unknown name'}): ${pushedForApp} reviews pushed from ${rawForApp} fetched in ${Date.now() - started} ms.`,
        );
    } catch (error) {
        const { errorType, message } = categorizeError(error);
        const item: FailureItem = {
            success: false,
            input: target.input,
            store: target.store,
            appId: target.appId,
            errorType,
            error: message,
            fetchedAt: new Date().toISOString(),
        };
        log.warning(
            `${label}: ${errorType} - ${message}${pushedForApp ? ` (after ${pushedForApp} reviews were already pushed)` : ''}`,
        );
        await Actor.pushData(item); // free of charge
        if (meta) {
            reviewsFetched += rawForApp;
            appSummaries.push(summarize(target, meta, rawForApp, pushedForApp));
        }
    }
}

// Simple worker pool: MAX_CONCURRENCY apps in flight, each app paginates sequentially with delays.
const queue = [...targets];
const workers = Array.from({ length: Math.min(MAX_CONCURRENCY, queue.length) }, async () => {
    while (queue.length && !stopBecauseOfBudget && !aborting) {
        const target = queue.shift();
        if (target) await processTarget(target);
    }
});
await Promise.all(workers);

const appsSucceeded = appSummaries.filter((s) => s.reviewsPushed > 0 || s.reviewsFetched > 0).length;
const summary = {
    appsRequested: rawApps.length,
    appsSucceeded,
    reviewsFetched,
    reviewsCharged,
    failures: failures.length + Math.max(targets.length - appsSucceeded, 0),
    stoppedEarlyDueToBudget: stopBecauseOfBudget,
    country,
    language,
    sort,
    apps: appSummaries,
};
await Actor.setValue('SUMMARY', summary);
log.info(`Done. ${JSON.stringify({ ...summary, apps: undefined })}`);

await Actor.exit();
