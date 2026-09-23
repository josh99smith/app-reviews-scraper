# Changelog

## 0.1.2 (2026-09-23)

- Listing: joined the Best Damn series. New title "Best Damn App Reviews Scraper", new description, icon and README banner. No change to inputs, output or pricing.
- README: new "Integrate and automate your workflow" section (Make, Zapier, n8n, Slack, Airbyte, GitHub, Google Drive, webhooks).
- Listing: "Best Damn" in the SEO title, refreshed banner, link to the new Best Damn YouTube Comments Scraper.
- README: link to the new Best Damn YouTube Scraper.

## 0.1.1 (2026-09-20)

- Fixed: with several apps fetched in parallel, two review pages could be delivered at once and overshoot the run's cost cap with reviews that were never billed. Charged pushes are now serialised and the remaining budget is also tracked from the Actor's own charge count.
- Duplicate apps in the input are now deduplicated by the Actor instead of being rejected by input validation.

## 0.1.0 (2026-09-18)

- Initial release: Apple App Store reviews via the public customer-reviews RSS feed (up to 500 per app and country) and Google Play reviews via the public Play web endpoints (google-play-scraper, MIT).
- Accepts store URLs, numeric Apple ids and Android package names in one list; the store is detected automatically.
- Sorting by newest, most helpful or rating, a rating window filter, a per-app review cap, and app metadata in the run summary.
- Not-found apps, invalid identifiers and store errors are reported in the dataset and never billed.
