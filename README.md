Collect **public user reviews from the Apple App Store and Google Play in a single run**. Paste app links or ids from either store and get back every review as a clean JSON record: star rating, title, text, reviewer display name, app version, date, helpful votes and the developer's reply where one exists. Apps that cannot be found are reported **free of charge**; you pay a small flat price per review.

Built for product managers, app marketers, researchers and developers who need review data as an API rather than copied from store pages.

## What can you do with App Store & Google Play Reviews Scraper?

- **Product feedback analysis**: find the bugs, feature requests and friction points users write about after every release, split by app version.
- **Competitor monitoring**: track what people like and dislike about competing apps, and schedule weekly runs to spot changes.
- **Sentiment pipelines**: feed reviews into your own classifier or a BI tool; the rating window filter lets you pull only 1-2 star complaints or only 5 star praise.
- **Feeding LLMs and agents**: the output is compact JSON that drops straight into a summarisation or RAG workflow, and the Actor is available through the Apify MCP server.

## How it works

For Apple the Actor reads the public customer-reviews feed that the App Store publishes for every app and country, plus the public lookup API for the app name, developer, average rating and rating count. For Google Play it uses the public web endpoints behind the Play store page (via the MIT-licensed `google-play-scraper` library). No login, no browser, low request rates: a run for two apps with 200 reviews each finishes in a few seconds.

Limits you should know: **Apple exposes at most 500 reviews per app per country** (10 pages of 50) and does not filter by language; the Apple feed also has no developer replies. Google Play returns reviews in pages of 150 and can go much deeper.

## How to use it

1. Open the Actor and paste your apps into **Apps**, one per line. App Store URLs, Google Play URLs, numeric Apple ids and Android package names all work and can be mixed.
2. Pick the **Country** (and, for Google Play, the **Language**), the **Sort order** and **Max reviews per app**. Narrow the **rating** window if you only want complaints or praise.
3. Click **Start**. Reviews appear in the **Output** tab as they arrive.
4. Download the dataset as JSON, CSV, Excel or XML, or send it to Google Sheets, Slack, Make or Zapier with an integration. The **API** tab shows how to start the Actor from code.

```json
{
    "apps": ["https://apps.apple.com/us/app/spotify-music-and-podcasts/id324684580", "com.spotify.music"],
    "country": "us",
    "language": "en",
    "sort": "newest",
    "maxReviewsPerApp": 200,
    "minRating": 1,
    "maxRating": 5
}
```

## Output

One record per review, identical shape for both stores:

```json
{
    "store": "google",
    "appId": "com.spotify.music",
    "appName": "Spotify: Music and Podcasts",
    "developer": "Spotify AB",
    "reviewId": "4cac1797-5266-4c68-b3f6-f86f63b2c5f5",
    "title": null,
    "text": "too much ad",
    "rating": 2,
    "authorName": "HIMANSHU RANJAN BEHERA",
    "version": "9.1.30.1993",
    "date": "2026-09-17T19:23:03.181Z",
    "helpfulVotes": 0,
    "developerReply": {
        "text": "Hi! We welcome your feedback and we'll pass it along to the ads team. ...",
        "date": "2026-09-17T19:45:13.542Z"
    },
    "country": "us",
    "language": "en",
    "url": "https://play.google.com/store/apps/details?id=com.spotify.music&reviewId=4cac1797-5266-4c68-b3f6-f86f63b2c5f5",
    "fetchedAt": "2026-09-18T19:46:00.886Z"
}
```

```json
{
    "store": "apple",
    "appId": "324684580",
    "appName": "Spotify: Music and Podcasts",
    "developer": "Spotify",
    "reviewId": "14560977347",
    "title": "Excelente servicio",
    "text": "Todo es mejor sin comerciales",
    "rating": 5,
    "authorName": "MoruXx",
    "version": "9.1.82",
    "date": "2026-09-17T16:18:01.000Z",
    "helpfulVotes": 0,
    "developerReply": null,
    "country": "us",
    "language": null,
    "url": "https://apps.apple.com/us/app/id324684580?see-all=reviews",
    "fetchedAt": "2026-09-18T19:46:00.626Z"
}
```

Apps that could not be processed are recorded too, so nothing silently disappears from your list:

```json
{
    "success": false,
    "input": "com.this.package.does.not.exist",
    "store": "google",
    "appId": "com.this.package.does.not.exist",
    "errorType": "not-found",
    "error": "App not found (404)",
    "fetchedAt": "..."
}
```

The `SUMMARY` record in the key-value store lists, for every app, the name, developer, average rating, total rating count and how many reviews were fetched and stored.

### Fields

| Field                             | Description                                                                                                          |
| --------------------------------- | -------------------------------------------------------------------------------------------------------------------- |
| `store`                           | `apple` or `google`.                                                                                                 |
| `appId` / `appName` / `developer` | Apple track id or Android package name, plus the store listing name and developer.                                   |
| `reviewId`                        | Store-assigned review id, unique per store.                                                                          |
| `title`                           | Review headline (Apple only; always `null` on Google Play).                                                          |
| `text` / `rating`                 | Review body and star rating 1-5.                                                                                     |
| `authorName`                      | The public display name shown next to the review.                                                                    |
| `version`                         | App version the review was written for, when the store provides it.                                                  |
| `date`                            | ISO 8601 timestamp of the review.                                                                                    |
| `helpfulVotes`                    | Helpful votes (Apple `voteSum`, Google Play thumbs-up).                                                              |
| `developerReply`                  | `{ text, date }` when the developer answered (Google Play only), otherwise `null`.                                   |
| `country` / `language`            | Store country of the review; language is the requested Play language and `null` for Apple.                           |
| `url`                             | Direct review link on Google Play, or the app's reviews page on the App Store.                                       |
| `errorType`                       | Failures only: `invalid-url`, `not-found`, `blocked`, `rate-limited`, `timeout`, `http-error`, `network` or `other`. |

## Pricing: how much does it cost to scrape app reviews?

You pay a **flat price per review stored** (shown next to the Start button); 1,000 reviews cost well under a dollar. Invalid identifiers, apps that do not exist and store errors are never charged, and there is no start-up fee. The Actor stops as soon as the maximum cost you set for the run is reached, so a long app list never produces a surprise bill.

## Tips

- **More Apple reviews**: the 500-review limit is per country. Run the same app with `country` set to `gb`, `de`, `fr`, `jp` and so on (or several runs on a schedule) and merge the datasets by `reviewId`.
- **Complaints only**: set `minRating` 1 and `maxRating` 2 to collect negative reviews; the Actor keeps paging until it finds enough or the store runs out.
- **Sort by rating**: Apple's feed cannot sort by rating, so the Actor downloads everything available and sorts locally. On Google Play, asking for low ratings switches to newest-first paging so that low-star reviews are actually reached.

## FAQ

**Why do I get fewer than 500 Apple reviews?**
Apple's feed serves up to 500 of the most recent (or most helpful) reviews per country, fewer for apps that do not have that many. Run per country for wider coverage.

**Why is `language` `null` for Apple reviews?**
The App Store feed does not accept a language parameter; it returns reviews in whatever language reviewers used in that country's store.

**Does it include reviewer email addresses or profile data?**
No. Only the public display name shown on the store page is stored, exactly as the store publishes it. Reviewer names are personal data in many jurisdictions; you are responsible for using the results in compliance with the privacy laws that apply to you (GDPR, CCPA and similar) and with the store terms.

**Is this legal?**
The Actor only reads pages and feeds that Apple and Google publish to everyone without a login, at low request rates, and stores what the stores show publicly. Using the data lawfully is your responsibility.

## Support and feedback

Found an app that is not parsed correctly or need an extra field? Open a ticket in the **Issues** tab of this Actor. The source code is MIT licensed.
