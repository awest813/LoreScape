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
    <a class="lore-source" href="https://github.com/awest813/LoreScape">Source on GitHub <svg class="lore-outbound" viewBox="0 0 16 16" aria-hidden="true"><path d="M4 12 12 4M4 4h8v8"/></svg></a></div>
    <nav class="lore-nav" aria-label="Main navigation">${pages.map(([path, title]): string => `<a href="${path}.html" ${path === pageName ? 'aria-current="page"' : ''}>${title}</a>`).join('')}</nav>
`;
document.body.prepend(header);
const skip: HTMLAnchorElement = header.querySelector<HTMLAnchorElement>('.lore-skip')!;
const skipTargets: Record<string, string> = {items: 'items', sounds: 'sounds', viewer: 'mainPanel', JagEd: 'mainPanel', mesanim: 'chat'};
if (skipTargets[pageName]) {
    skip.href = `#${skipTargets[pageName]}`;
    skip.textContent = 'Skip to tool';
}
skip.addEventListener('click', (event: MouseEvent): void => {
    const root: HTMLElement | null = document.getElementById(skip.hash.slice(1));
    if (!root) return;
    const target: HTMLElement = root.querySelector<HTMLElement>('input[type="search"]:not(:disabled)') || root.querySelector<HTMLElement>('input:not(:disabled), button:not(:disabled), canvas') || root;
    if (!target.matches('input, button, canvas, a, select, textarea')) target.tabIndex = -1;
    event.preventDefault();
    target.focus({preventScroll: true});
    target.scrollIntoView({block: 'center'});
});
const status: HTMLElement = document.createElement('section');
status.className = 'lore-status';
status.setAttribute('aria-label', 'Client status');
status.innerHTML = '<p id="lore-status-message" role="status" aria-live="polite">Connecting to the world service…</p><button type="button" id="lore-retry" hidden>Reload and retry</button>';
header.after(status);
type RetryAction = {label: string; action: () => void};
const reload: () => void = (): void => window.location.reload();
let retryAction: () => void = reload;
document.getElementById('lore-retry')?.addEventListener('click', (): void => retryAction());

export function setPageStatus(message: string, failed: boolean = false, retryActionOverride?: RetryAction): void {
    const text: HTMLElement | null = document.getElementById('lore-status-message');
    if (text) text.textContent = message;
    status.classList.toggle('lore-status-error', failed);
    window.dispatchEvent(new CustomEvent('lore:status', {detail: {message, failed}}));
    const retry: HTMLElement | null = document.getElementById('lore-retry');
    retryAction = retryActionOverride?.action || reload;
    if (retry) {
        retry.hidden = !failed;
        retry.textContent = retryActionOverride?.label || 'Reload and retry';
    }
}

export function showStartupError(error?: unknown): void {
    const cause: unknown = typeof ErrorEvent !== 'undefined' && error instanceof ErrorEvent ? error.error : typeof PromiseRejectionEvent !== 'undefined' && error instanceof PromiseRejectionEvent ? error.reason : error;
    const detail: string = cause instanceof Error ? cause.message : '';
    setPageStatus(`Unable to load the client. ${detail || 'Check your connection and try again, or choose another world. Game servers and files must be available separately from this website.'}`, true);
}

export function setReadyStatus(): void {
    let guidance: string = 'Click or focus the canvas to use the client.';
    if (pageName === 'sounds') guidance = 'Search for a sound, then select it to play.';
    else if (pageName === 'items') guidance = 'Search for an item, then select it to update the item command.';
    else if (pageName === 'viewer' || pageName === 'JagEd') guidance = document.getElementById('modelList') ? 'Select a model from your cache.' : 'Open a classic cache ZIP or folder to begin.';
    setPageStatus(`Ready. ${guidance}`);
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
        showStartupError(error);
    }
}
