import {setPageStatus} from './page-shell';
import type Database from './jagex2/io/Database';

type CacheWriter = Pick<Database, 'cachesave'>;
const supportedNames: Set<string> = new Set(['main_file_cache.dat', 'main_file_cache.idx0', 'main_file_cache.idx1', 'main_file_cache.idx2', 'main_file_cache.idx3', 'main_file_cache.idx4']);

export async function importCacheFiles(files: ArrayLike<File>, cache: CacheWriter | null): Promise<number> {
    const supported: File[] = Array.from(files).filter((file: File): boolean => supportedNames.has(file.name));
    if (!supported.length) throw new Error('Choose main_file_cache.dat or main_file_cache.idx0 through main_file_cache.idx4.');
    for (const file of supported) {
        if (!(await cache?.cachesave(file.name, new Int8Array(await file.arrayBuffer())))) {
            throw new Error('Cannot import cache files because browser storage is unavailable. Enable site storage and reload before importing again.');
        }
    }
    return supported.length;
}

export function setupCacheImport(cache: CacheWriter | null, refresh: () => Promise<void>): void {
    const input: HTMLInputElement | null = document.querySelector('#cache-files');
    const panel: HTMLElement | null = document.getElementById('mainPanel');
    if (!input || !panel) return;
    let importing: boolean = false;
    input.disabled = false;
    const load = async (files: FileList | null): Promise<void> => {
        if (importing || !files?.length) return;
        importing = true;
        const restoreFocus: boolean = document.activeElement === input;
        input.disabled = true;
        panel.setAttribute('aria-busy', 'true');
        setPageStatus('Importing cache files…');
        try {
            const count: number = await importCacheFiles(files, cache);
            await refresh();
            setPageStatus(`Imported ${count} cache ${count === 1 ? 'file' : 'files'}.`);
        } catch (error) {
            setPageStatus(error instanceof Error ? error.message : 'Unable to import these cache files.', true);
        } finally {
            importing = false;
            input.disabled = false;
            input.value = '';
            panel.removeAttribute('aria-busy');
            if (restoreFocus && document.activeElement === document.body) input.focus();
        }
    };
    input.addEventListener('change', (): void => {
        void load(input.files);
    });
    panel.ondragover = (event: DragEvent): void => {
        event.preventDefault();
    };
    panel.ondrop = (event: DragEvent): void => {
        event.preventDefault();
        void load(event.dataTransfer?.files || null);
    };
}
