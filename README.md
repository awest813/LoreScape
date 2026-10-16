# LoreScape

A browser client and collection of cache tools based on the [2004Scape TypeScript client](https://github.com/2004scape/Client2), a source port of the 2004 client refactor.

The home page provides world and graphics controls, keyboard-accessible navigation, loading progress, and recovery messages. Game files and live worlds come from the 2004Scape services. **GitHub Pages hosts only the website; it does not run a game server.** Availability, account requirements, membership, and cross-origin access are controlled by the selected server.

## Develop locally

Use Node.js 22.22.1 or newer (`nvm use` selects the latest Node 22 release):

```sh
npm ci
npm run dev
```

Open `http://localhost:8080/`. The client defaults to live world 1. Choose a world in the form or use `?world=1&detail=low&method=0`. Low detail is useful on slower devices. Desktop keyboard and mouse are recommended; the canvas scales to smaller screens.

World 0 connects to a separately running local server at `http://localhost`. Use the local HTTP development site for world 0. HTTPS-hosted Pages cannot use this configuration. Worlds 998 and 999 require separate peer/worker server bundles and game data; they are not included in a normal build.

## Validate and build

```sh
npm run lint
npm run typecheck
npm test -- --runInBand
npm run build
npm run check:pages
```

The build compiles the Bzip2 WebAssembly module and writes the website to `public/`. It uses relative asset paths, so the same build works at `/LoreScape/`, at another repository path, or on a root/custom domain. JavaScript and CSS use content hashes and shared chunks. Keep the generated HTML, JavaScript, CSS, WebAssembly, soundfont, manifest, and icons together.

To preview production locally, run `npm run preview` after building. To test the exact generated files with any static HTTP server, serve `public/`; do not open the HTML using `file://`.

`public/` is generated and ignored by Git. Save source edits in `src/`. Optional server bundles/data placed in `public/` must be supplied separately in every deployment; never publish player saves or credentials.

## Audit limits

Production dependencies currently have no known npm advisories. The development dependency tree retains 25 advisories (5 high, 20 moderate), rooted in unpatched releases of `braces` and `sprintf-js`. Critical findings from the original lockfile have been resolved. Review `npm audit` as upstream patches become available; the development server is not part of the Pages deployment.

The build succeeds with Sass deprecation warnings from the legacy Foundation styles and bundle-size warnings. A future Sass migration remains necessary. Automated browser checks use controlled world-service responses; live login and gameplay require verification against the selected external server from the deployed origin.

## Deploy to GitHub Pages

1. In the repository, open **Settings → Pages → Build and deployment**, and select **GitHub Actions** as the source.
2. Push these changes to `main`, or run **Validate and deploy GitHub Pages** in the Actions tab on `main`.
3. The workflow installs from the lockfile, runs lint, type checking and tests, builds the site, validates the generated assets, then uploads and deploys the Pages artifact. Pull requests run the same validation without deploying.
4. Once the deployment succeeds, open `https://awest813.github.io/LoreScape/`. Check a direct link such as `index.html?world=1&detail=low`, the tool links, and the manifest. Use the deployment job's URL if the repository name, owner, or domain changes.

If you previously deployed from a `gh-pages` branch, selecting **GitHub Actions** replaces that deployment source. No PAT, custom deploy key, or manually committed build output is required. Repository or organization settings may require an environment approval for the `github-pages` environment.

## Pages and controls

| Page | Purpose |
| --- | --- |
| `index.html` | Game client with world and detail settings |
| `playground.html` | Interactive model viewer |
| `items.html` | Item list and search |
| `sounds.html` | Sound viewer and playback |
| `mesanim.html` | Chat message animation editor |
| `mapview.html` | World map viewer |
| `viewer.html` | Cache viewer; load your own cache files |
| `interface-editor.html` | Interface editor (experimental) |
| `JagEd.html` | Cache editor (experimental) |

Click or Tab to the canvas to use the keyboard. In model/cache viewers, use arrow keys to rotate, W/S to zoom, R to reset, and `[` / `]` to adjust movement. Game commands include `::debug` for performance metrics, `::chat` for chat font eras, and `::fps 30` for a frame-rate target.

## Connection troubleshooting

- If loading fails, check your connection, use **Reload and retry**, or choose another world. World-list requests have a 10-second timeout and at most three attempts. File downloads time out after 30 seconds; archive requests also have bounded retries.
- Live world services must support HTTPS and permit requests from the deployed site's origin. The website cannot override a server's CORS settings or host a WebSocket server on Pages.
- Cache tools that download game files need the same services. Cache viewer and JagEd let you load cache files from your computer. Some tool data also comes from the upstream server repository on GitHub.
- The manifest provides app metadata; it does not provide offline game data or a service worker. A normal deployment requires network access.
- If a deployment fails, inspect the first failing Actions step. Asset checks detect missing files, invalid Bzip2 WebAssembly, and root-relative asset paths that would break project hosting.

## Attribution

Based on 2004Scape Client2 and its contributors. This is an independent community project, unaffiliated with Jagex. RuneScape is a trademark of Jagex Ltd. The original project identifies its client code as a TypeScript source port; retain upstream attribution and review rights for any game assets you distribute.
