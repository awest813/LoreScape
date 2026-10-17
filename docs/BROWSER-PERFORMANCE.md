# Browser performance and compatibility

The client keeps its simulation/input/network loop separate from rendering. Device preferences and `::fps 15`, `::fps 30`, or `::fps 50` cap drawing without adding a sleep to game updates. Hidden documents draw at most once per second and resume rendering immediately when visible. Browsers can still suspend background tabs and workers; this cannot guarantee that a browser-hosted server stays online while its host is suspended.

Render buffers allocate blank image data instead of reading pixels back from the canvas. A local headless Chromium microbenchmark (seven rounds, median of 100 allocations at 512×334) measured about 63 ms for readback and 1 ms for allocation. This measures buffer creation, not overall game speed. Frame-time history now uses a bounded 50-sample ring instead of an empty array that produced invalid timing statistics.

Local setup login uses AbortController with a cleared timer rather than requiring AbortSignal.timeout. The deadline also covers reading the configuration response body. Browsers still need JavaScript BigInt, WebAssembly, Canvas 2D, fetch, and WebSockets. Cache tools can run without persistent storage; compressed ZIP support depends on the browser's decompression APIs, with extracted-folder import available as a fallback.

Verification covers Chromium, mobile/Chromebook viewport sizes, simulated unavailable browser APIs, real browser-hosted login/gameplay/saving, and unit tests for frame pacing and timeout cleanup. Firefox, Safari, and physical managed Chromebooks have not been verified in this environment.

To repeat gameplay measurements, prepare the complete browser-server package with `npm run setup:web`, start it with `npm start`, then run `npm run test:performance`. Set `LORESCAPE_CHROMIUM_PATH` for a system Chromium and `LORESCAPE_TEST_URL` for a different local origin. The check logs update/draw rates at 50 FPS, 15 FPS, simulated hidden, and visible again, then verifies a saved character. It blocks service workers so test-only instrumentation cannot be bypassed by a cached bundle. Performance depends on hardware and competing workloads.

A logged-in Chromium run of the optimized complete package measured:

| Mode | Draws/second | Updates/second | Drawing time per second |
| --- | ---: | ---: | ---: |
| 50 FPS | 49.6 | 53.8 | 305 ms |
| 15 FPS | 15.0 | 51.5 | 90 ms |
| Simulated hidden | 1.0 | 51.8 | 6 ms |
| Visible again | 48.8 | 50.8 | 290 ms |

These are five-second samples on this development machine, not device-wide guarantees. The hidden sample reduced measured drawing time by about 98%; server work, audio, and browser overhead are separate. Login, all four measurements, and character saving passed with the complete package.
