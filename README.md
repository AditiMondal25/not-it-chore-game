# Not It!

Phone-first multiplayer chore bidding game with a Diwali-night look. Netlify serves the files in `public/`; `netlify/functions/game.ts` and Netlify Blobs handle rooms, private bids, timers, scoring, reconnects, and host handover. The client polls the function and stores its room credentials locally.

## Deploy on Netlify

1. Unzip `netlify-ready-game.zip`.
2. Sign in to Netlify, open [Netlify Drop](https://app.netlify.com/drop), and drop the **unzipped project folder** (the folder containing `netlify.toml`, `package.json`, `public/`, and `netlify/`).
3. Wait for the deploy to finish. Open the site’s Functions page and confirm it lists `game`.
4. Open `https://YOUR-SITE/.netlify/functions/game` in a browser. It should show `{"ok":true}`. Then create a room and test from a second phone or private browser window.

If the `game` function is missing, the site’s HTML may still load but multiplayer will not work. Check the deploy log for a successful build and the Functions page for `game`. Drop the project folder while signed in so Netlify can detect and build it. Netlify’s docs say logged-in Drop can build detected projects, while manual deploys do not run a build command; function source needs a Netlify build or a CLI/API function deploy. If Drop publishes only static files, re-dropping `public/` cannot add the function. The supported fallback is to build/deploy with Netlify CLI or connect the project to a Git provider for Netlify builds. Those routes require relaxing the browser-only/no-Git constraint.

## Local checks

- `npm install`
- `npm test` runs the automated rules and game-flow tests.
- `npm run dev` starts Netlify Dev with local Blobs. Open `http://localhost:8888` to play; run `node tests/served-smoke.js` in another terminal for the full local HTTP game check.

## Playing

Create a room on one screen and join it from another using the four-letter code. During bidding, bids stay private until reveal. A timeout counts as a bid of 30. The lowest eligible bid gets the chore, with ties settled by fewer chores and then randomness. A NOT IT tap is refused when every other eligible player has used theirs; a successful dodge pays twice the doer’s bid. Room state expires after two hours without activity. Refreshing the page rejoins with the same local player credentials.
