import {setPageStatus} from './page-shell';
import {cacheNames, readCacheFolder, readCacheZip} from './cache-bundle';
import type Database from './jagex2/io/Database';

type CacheWriter = Pick<Database, 'cachesave'> & Partial<Pick<Database, 'cachesaveMany' | 'persistent'>>;
const supportedNames: Set<string> = new Set(cacheNames);

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

export async function importCacheSelection(files: ArrayLike<File>, cache: CacheWriter | null, folder: boolean = false): Promise<number> {
    const selected: File[] = Array.from(files);
    if (!folder && !selected.some((file: File): boolean => !!file.webkitRelativePath)) {
        const zips: File[] = selected.filter((file: File): boolean => file.name.toLowerCase().endsWith('.zip'));
        if (!zips.length) return importCacheFiles(selected, cache);
        if (selected.length !== 1) throw new Error('Choose one cache ZIP at a time, or select a cache folder.');
    }
    const bundle: import('./cache-bundle').CacheFile[] = folder || selected.some((file: File): boolean => !!file.webkitRelativePath) ? await readCacheFolder(selected) : await readCacheZip(selected[0]);
    if (cache?.cachesaveMany) {
        if (!(await cache.cachesaveMany(bundle))) throw new Error('Cannot save this cache. Check browser site storage, reload, and import it again.');
    } else {
        for (const file of bundle) {
            if (!(await cache?.cachesave(file.name, new Int8Array(file.bytes)))) throw new Error('Cannot save this cache. Check browser site storage, reload, and import it again.');
        }
    }
    return bundle.length;
}

export function setupCacheImport(cache: CacheWriter | null, refresh: () => Promise<void>): void {
    const input: HTMLInputElement | null = document.querySelector('#cache-files');
    const folder: HTMLInputElement | null = document.querySelector('#cache-folder');
    const panel: HTMLElement | null = document.getElementById('mainPanel');
    if (!input || !panel) return;
    if (cache?.persistent === false) {
        const notice: HTMLParagraphElement = document.createElement('p');
        notice.textContent = 'Browser storage is unavailable. You can still open a cache in this tab. Select the ZIP or folder again after reloading.';
        document.getElementById('cache-import-help')?.after(notice);
    }
    const inputs: HTMLInputElement[] = folder ? [input, folder] : [input];
    let importing: boolean = false;
    for (const control of inputs) control.disabled = false;
    const load = async (files: FileList | null, isFolder: boolean = false): Promise<void> => {
        if (importing || !files?.length) return;
        importing = true;
        const focused: HTMLInputElement | undefined = inputs.find((control: HTMLInputElement): boolean => document.activeElement === control);
        for (const control of inputs) control.disabled = true;
        panel.setAttribute('aria-busy', 'true');
        setPageStatus('Reading and importing cache…');
        try {
            const count: number = await importCacheSelection(files, cache, isFolder);
            await refresh();
            const incomplete: boolean = panel.querySelector<HTMLCanvasElement>('#canvas')?.style.display === 'none';
            setPageStatus(
                `Imported ${count} cache ${count === 1 ? 'file' : 'files'}.${incomplete ? ' Add the remaining cache files, or open a complete classic cache ZIP.' : ''}${cache?.persistent === false ? ' Available in this tab only; reopen the cache after reloading.' : ''}`
            );
        } catch (error) {
            setPageStatus(error instanceof Error ? error.message : 'Unable to import this cache.', true, {
                label: 'Choose another cache',
                action: (): void => {
                    input.focus();
                    input.click();
                }
            });
        } finally {
            importing = false;
            for (const control of inputs) {
                control.disabled = false;
                control.value = '';
            }
            panel.removeAttribute('aria-busy');
            if (focused && document.activeElement === document.body) focused.focus();
        }
    };
    input.addEventListener('change', (): void => {
        void load(input.files);
    });
    folder?.addEventListener('change', (): void => {
        void load(folder.files, true);
    });
    panel.ondragover = (event: DragEvent): void => {
        event.preventDefault();
    };
    panel.ondrop = (event: DragEvent): void => {
        event.preventDefault();
        void load(event.dataTransfer?.files || null);
    };
}
