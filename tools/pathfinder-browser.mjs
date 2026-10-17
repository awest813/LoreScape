import { readFileSync } from 'node:fs';

// The pinned npm package ships Node-only wasm-bindgen glue. Preserve its
// generated bindings and wasm bytes, replacing only Node's loader with fetch.
export const browserPathfinder = {
    name: 'lorescape-browser-pathfinder',
    setup(build) {
        build.onLoad({ filter: /[/\\]lostcity[/\\]util[/\\]WorkerFactory\.ts$/ }, () => ({ contents: "export function createWorker(filename) { const worker = new Worker(filename, { type: 'module' }); worker.addEventListener('message', event => { if (event.data.type === 'coop-storage') self.postMessage(event.data); }); return worker; }", loader: 'js' }));
        build.onResolve({ filter: /^kleur$/ }, () => ({ path: 'colors', namespace: 'lorescape' }));
        build.onLoad({ filter: /^colors$/, namespace: 'lorescape' }, () => ({ contents: 'const color = new Proxy(() => {}, { get: () => color, apply: (_, __, args) => args.length ? args[0] : color }); export default color;', loader: 'js' }));
        // Public-server monitoring has no endpoint in a browser-hosted world.
        build.onResolve({ filter: /^prom-client$/ }, () => ({ path: 'metrics', namespace: 'lorescape' }));
        build.onLoad({ filter: /^metrics$/, namespace: 'lorescape' }, () => ({ contents: 'class Metric { observe() {} inc() {} set() {} } export { Metric as Counter, Metric as Gauge, Metric as Histogram };', loader: 'js' }));
        build.onLoad({ filter: /[/\\]rsmod-pathfinder[/\\]dist[/\\]rsmod-pathfinder\.js$/ }, ({ path }) => {
            let source = readFileSync(path, 'utf8');
            const names = [...new Set([...source.matchAll(/module\.exports\.(\w+)\s*=/g)].map(match => match[1]))];
            const decoder = 'const { TextDecoder } = require(`util`);';
            const loader = /const path = require\('path'\)\.join\(__dirname, 'rsmod-pathfinder_bg\.wasm'\);\s*const bytes = require\('fs'\)\.readFileSync\(path\);/;
            if (!source.includes(decoder) || !loader.test(source)) throw new Error('Unexpected pathfinder package layout');
            source = source.replace(decoder, '').replace(loader, "const response = await fetch('rsmod-pathfinder.wasm');\nif (!response.ok) throw new Error('Pathfinder wasm could not be loaded');\nconst bytes = await response.arrayBuffer();");
            source = 'const bindings = {};\n' + source.replaceAll('module.exports', 'bindings');
            source += '\n' + names.map(name => `export const ${name} = bindings.${name};`).join('\n');
            return { contents: source, loader: 'js' };
        });
    }
};
