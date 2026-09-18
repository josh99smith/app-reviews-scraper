# Changelog

## 0.1.0 (2026-09-18)

- Initial release: Apple App Store reviews via the public customer-reviews RSS feed (up to 500 per app and country) and Google Play reviews via the public Play web endpoints (google-play-scraper, MIT).
- Accepts store URLs, numeric Apple ids and Android package names in one list; the store is detected automatically.
- Sorting by newest, most helpful or rating, a rating window filter, a per-app review cap, and app metadata in the run summary.
- Not-found apps, invalid identifiers and store errors are reported in the dataset and never billed.
