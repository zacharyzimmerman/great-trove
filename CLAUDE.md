# Great Trove

Barbershop contest scoresheet browser PWA. Part of the "great apps" family (great-tags, great-tunes, great-trove).

## Architecture

- **Vanilla JS PWA** — no build tools, uses shared framework from `https://cdn.jsdelivr.net/gh/zacharyzimmerman/great-apps@main/`
- **Data**: `web/trove-bundle.json` generated from barbershop-database SQLite DB
- **Deploy**: GitHub Pages from `web/` directory

## Key Commands

```bash
npm run bundle    # Generate web/trove-bundle.json from barbershop.db
npm run bump      # Bump version (package.json, sw.js, index.html)
npm run dev       # Local dev server on port 3000
```

## Data Source

The bundle script reads from `Q:\personal\barbershop-database\data\barbershop.db`. Run `npm run bundle` after any re-parse of the barbershop-database.

## Version Bumping

Every push to `main` MUST include a version bump. The SW uses the version as its cache key. If you push code changes without bumping the version, users' browsers will keep serving stale cached files indefinitely.

## Testing

No test framework — the app is a static PWA. Verify by running `npm run dev` and checking the browser.
