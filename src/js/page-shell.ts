import '../style/page-shell.scss';
import {setupManifest} from './manifest';

const pageName: string =
    window.location.pathname
        .split('/')
        .pop()
        ?.replace(/\.html$/, '') || 'index';
const pages: [string, string][] = [
    ['index', 'Play'],
    ['playground', 'Models'],
    ['items', 'Items'],
    ['sounds', 'Sounds'],
    ['mesanim', 'Chat animations'],
    ['mapview', 'Map'],
    ['viewer', 'Cache viewer'],
    ['interface-editor', 'Interfaces'],
    ['JagEd', 'JagEd']
];
const header: HTMLElement = document.createElement('header');
header.className = 'lore-header';
header.innerHTML = `
    <a class="lore-skip" href="#canvas">Skip to client</a>
    <div class="lore-heading"><a class="lore-brand" href="index.html">LoreScape<span>Classic adventures. In your browser.</span></a>
    <a class="lore-source" href="https://github.com/awest813/LoreScape">Source on GitHub ↗</a></div>
    <nav class="lore-nav" aria-label="Main navigation">${pages.map(([path, title]): string => `<a href="${path}.html" ${path === pageName ? 'aria-current="page"' : ''}>${title}</a>`).join('')}</nav>
`;
document.body.prepend(header);
const status: HTMLElement = document.createElement('section');
status.className = 'lore-status';
status.setAttribute('aria-label', 'Client status');
status.innerHTML = '<p id="lore-status-message" role="status" aria-live="polite">Connecting to the world service…</p><button type="button" id="lore-retry" hidden>Reload and retry</button>';
header.after(status);
document.getElementById('lore-retry')?.addEventListener('click', (): void => window.location.reload());

export function setPageStatus(message: string, failed: boolean = false): void {
    const text: HTMLElement | null = document.getElementById('lore-status-message');
    if (text) text.textContent = message;
    status.classList.toggle('lore-status-error', failed);
    const retry: HTMLElement | null = document.getElementById('lore-retry');
    if (retry) retry.hidden = !failed;
}

export function showStartupError(): void {
    setPageStatus('Unable to load the client. Check your connection and try again, or choose another world. Game servers and files must be available separately from this website.', true);
}

window.addEventListener('unhandledrejection', showStartupError);
window.addEventListener('error', showStartupError);
setupManifest();

const parameters: URLSearchParams = new URLSearchParams(window.location.search);
for (const name of ['world', 'detail']) {
    const control: HTMLInputElement | HTMLSelectElement | null = document.querySelector(`#${name}`);
    const value: string | null = parameters.get(name);
    if (control && value) control.value = value;
}

export async function startClient(start: () => Promise<void>): Promise<void> {
    try {
        await start();
    } catch (error) {
        console.error(error);
        showStartupError();
    }
}
