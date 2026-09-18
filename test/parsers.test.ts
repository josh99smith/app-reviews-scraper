import { describe, expect, it } from 'vitest';

import {
    appleFeedEntries,
    appleFeedUrl,
    decodeXmlEntities,
    parseAppleEntry,
    parseAppleLookup,
    parseAppleXml,
} from '../src/apple.js';
import { GOOGLE_PAGE_SIZE, googleReviewUrl, mapGoogleReview } from '../src/google.js';
import { categorizeError, passesRatingFilter, type Review, sortReviews, StoreError } from '../src/types.js';

const meta = {
    appName: 'Spotify: Music and Podcasts',
    developer: 'Spotify',
    averageRating: 4.77,
    ratingCount: 42146337,
    url: 'https://apps.apple.com/us/app/id324684580',
};
const fetchedAt = '2026-09-18T00:00:00.000Z';

const APPLE_XML = `<?xml version="1.0" encoding="utf-8"?>
<feed xmlns:im="http://itunes.apple.com/rss" xmlns="http://www.w3.org/2005/Atom" xml:lang="en">
<id>https://itunes.apple.com/us/rss/customerreviews/page=2/id=324684580/sortby=mostrecent/xml</id><title>iTunes Store: Customer Reviews</title>
<entry>
<id>14560118397</id>
<title>Premium &amp; needed</title>
<content type="text">Wish I had premium &lt;3 &#128064; &#x1F600;</content>
<im:contentType term="Application" label="Application"/>
<im:voteSum>3</im:voteSum>
<im:voteCount>4</im:voteCount>
<im:rating>4</im:rating>
<updated>2026-09-17T05:05:35-07:00</updated>
<im:version>9.1.82</im:version>
<author><name>Take-Yuh-Gurl</name><uri>https://itunes.apple.com/us/reviews/id1830939461</uri></author>
<link rel="related" href="https://itunes.apple.com/us/review?id=324684580&amp;type=Purple%20Software"/>
<content type="html">&lt;table&gt;ignored&lt;/table&gt;</content>
</entry>
<entry>
<id>14560118398</id>
<title>Second</title>
<content type="text">Fine</content>
<im:voteSum>0</im:voteSum>
<im:voteCount>0</im:voteCount>
<im:rating>1</im:rating>
<updated>2026-09-16T05:05:35-07:00</updated>
<im:version>9.1.80</im:version>
<author><name>someone</name><uri>https://itunes.apple.com/us/reviews/id1</uri></author>
</entry>
</feed>`;

describe('Apple feed', () => {
    it('builds XML feed URLs with the right sort', () => {
        expect(appleFeedUrl('1', 'gb', 3, 'helpful')).toBe(
            'https://itunes.apple.com/gb/rss/customerreviews/page=3/id=1/sortby=mosthelpful/xml',
        );
        expect(appleFeedUrl('1', 'us', 1, 'rating')).toContain('sortby=mostrecent');
    });

    it('decodes XML entities including numeric ones', () => {
        expect(decodeXmlEntities('a &amp; b &lt;3 &#65; &#x41; &unknown;')).toBe('a & b <3 A A &unknown;');
    });

    it('parses XML entries and picks the text content, not the html one', () => {
        const entries = parseAppleXml(APPLE_XML);
        expect(entries).toHaveLength(2);
        const review = parseAppleEntry(entries[0], { appId: '324684580', country: 'us', meta, fetchedAt });
        expect(review).toMatchObject({
            store: 'apple',
            appId: '324684580',
            appName: 'Spotify: Music and Podcasts',
            reviewId: '14560118397',
            title: 'Premium & needed',
            text: 'Wish I had premium <3 \u{1F440} \u{1F600}',
            rating: 4,
            authorName: 'Take-Yuh-Gurl',
            version: '9.1.82',
            date: '2026-09-17T12:05:35.000Z',
            helpfulVotes: 3,
            developerReply: null,
            country: 'us',
            language: null,
            url: 'https://apps.apple.com/us/app/id324684580?see-all=reviews',
        });
    });

    it('returns no entries for a feed page without reviews and rejects non-feed bodies', () => {
        expect(parseAppleXml('<?xml version="1.0"?><feed><title>empty</title></feed>')).toEqual([]);
        expect(() => parseAppleXml('<html>blocked</html>')).toThrow(StoreError);
    });

    it('handles the JSON feed returning a single bare entry object', () => {
        expect(appleFeedEntries({ feed: { entry: { id: { label: '1' } } } })).toHaveLength(1);
        expect(appleFeedEntries({ feed: {} })).toEqual([]);
    });

    it('drops entries without an id or rating', () => {
        expect(parseAppleEntry({ title: { label: 'x' } }, { appId: '1', country: 'us', meta, fetchedAt })).toBeNull();
        expect(
            parseAppleEntry(
                { id: { label: '5' }, 'im:rating': { label: 'abc' } },
                { appId: '1', country: 'us', meta, fetchedAt },
            ),
        ).toBeNull();
    });

    it('parses lookup responses and reports missing apps', () => {
        const json = {
            resultCount: 1,
            results: [
                {
                    trackName: 'Spotify',
                    artistName: 'Spotify',
                    averageUserRating: 4.77341,
                    userRatingCount: 42,
                    trackViewUrl: 'https://apps.apple.com/us/app/x/id1?uo=4',
                },
            ],
        };
        expect(parseAppleLookup(json, '1', 'us')).toEqual({
            appName: 'Spotify',
            developer: 'Spotify',
            averageRating: 4.77,
            ratingCount: 42,
            url: 'https://apps.apple.com/us/app/x/id1',
        });
        expect(parseAppleLookup({ resultCount: 0, results: [] }, '1', 'us')).toBeNull();
        expect(parseAppleLookup('garbage', '1', 'us')).toBeNull();
    });
});

describe('Google Play mapping', () => {
    const ctx = { appId: 'com.spotify.music', country: 'us', language: 'en', meta, fetchedAt };

    it('maps a review with a developer reply', () => {
        const review = mapGoogleReview(
            {
                id: 'abc-123',
                userName: 'Jane',
                date: '2026-09-17T19:23:03.181Z',
                score: 2,
                text: '  too much ad ',
                replyText: 'Hi! Thanks',
                replyDate: '2026-09-17T19:45:13.542Z',
                version: '9.1.30',
                thumbsUp: 7,
                title: '',
            },
            ctx,
        );
        expect(review).toMatchObject({
            store: 'google',
            reviewId: 'abc-123',
            title: null,
            text: 'too much ad',
            rating: 2,
            authorName: 'Jane',
            version: '9.1.30',
            helpfulVotes: 7,
            developerReply: { text: 'Hi! Thanks', date: '2026-09-17T19:45:13.542Z' },
            language: 'en',
            url: googleReviewUrl('com.spotify.music', 'abc-123'),
        });
    });

    it('nulls missing optional fields and rejects malformed items', () => {
        const review = mapGoogleReview(
            { id: 'x', score: 5, text: 'ok', replyText: null as unknown as string, version: null as unknown as string },
            ctx,
        );
        expect(review).toMatchObject({
            developerReply: null,
            version: null,
            authorName: null,
            helpfulVotes: 0,
            date: null,
        });
        expect(mapGoogleReview({ score: 5 }, ctx)).toBeNull();
        expect(mapGoogleReview({ id: 'x', score: 0 }, ctx)).toBeNull();
        expect(GOOGLE_PAGE_SIZE).toBe(150);
    });
});

describe('shared helpers', () => {
    it('categorizes errors', () => {
        expect(categorizeError(new StoreError('blocked', 'nope')).errorType).toBe('blocked');
        expect(categorizeError(Object.assign(new Error('App not found (404)'), { status: 404 })).errorType).toBe(
            'not-found',
        );
        expect(
            categorizeError(Object.assign(new Error('Error requesting Google Play'), { status: 429 })).errorType,
        ).toBe('rate-limited');
        expect(
            categorizeError(Object.assign(new Error('Error requesting Google Play'), { status: 403 })).errorType,
        ).toBe('blocked');
        expect(
            categorizeError(Object.assign(new Error('Error requesting Google Play'), { status: 500 })).errorType,
        ).toBe('http-error');
        expect(categorizeError(new Error('The operation was aborted due to timeout')).errorType).toBe('timeout');
        expect(categorizeError(new Error('fetch failed')).errorType).toBe('network');
        expect(categorizeError(new Error('getaddrinfo ENOTFOUND play.google.com')).errorType).toBe('network');
        expect(categorizeError('weird').errorType).toBe('other');
    });

    it('filters by rating window', () => {
        expect(passesRatingFilter(3, 1, 5)).toBe(true);
        expect(passesRatingFilter(3, 4, 5)).toBe(false);
        expect(passesRatingFilter(Number.NaN, 1, 5)).toBe(false);
    });

    it('sorts reviews', () => {
        const mk = (rating: number, helpfulVotes: number, date: string): Review =>
            ({ rating, helpfulVotes, date, reviewId: `${rating}-${helpfulVotes}` }) as Review;
        const list = [mk(3, 1, '2026-01-01'), mk(5, 0, '2025-01-01'), mk(5, 9, '2026-02-01')];
        expect(sortReviews(list, 'rating').map((r) => r.reviewId)).toEqual(['5-9', '5-0', '3-1']);
        expect(sortReviews(list, 'helpful').map((r) => r.reviewId)).toEqual(['5-9', '3-1', '5-0']);
        expect(sortReviews(list, 'newest').map((r) => r.reviewId)).toEqual(['5-9', '3-1', '5-0']);
        expect(list[0].reviewId).toBe('3-1'); // input untouched
    });
});
