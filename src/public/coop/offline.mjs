export async function offlineAction(type, progress = () => {}, signal) {
    if (!isSecureContext || !('serviceWorker' in navigator)) throw new Error('Offline play requires HTTPS or localhost and service worker support');
    if (signal?.aborted) throw signal.reason || new Error('Offline download cancelled');
    const base = new URL('../', import.meta.url);
    const existing = await navigator.serviceWorker.getRegistration(base);
    const registration = existing?.scope === base.href ? existing : await navigator.serviceWorker.register(new URL('offline-sw.js', base), {scope: base.pathname});
    registration.update().catch(() => {});
    if (!registration.active) await new Promise((resolve, reject) => {
        const interval = setInterval(() => {
            if (registration.active || signal?.aborted) {
                clearInterval(interval);
                clearTimeout(timer);
                signal?.aborted ? reject(signal.reason || new Error('Offline download cancelled')) : resolve();
            }
        }, 100);
        const timer = setTimeout(() => {
            clearInterval(interval);
            reject(new Error('Offline setup timed out. Reload and try again.'));
        }, 30000);
    });
    if (signal?.aborted) throw signal.reason || new Error('Offline download cancelled');
    if (!registration.active) throw new Error('Offline setup is not ready. Reload and try again.');
    return new Promise((resolve, reject) => {
        const channel = new MessageChannel();
        const cancel = () => channel.port1.postMessage({type: 'cancel'});
        const finish = (error, result) => {
            clearTimeout(timer);
            signal?.removeEventListener('abort', cancel);
            channel.port1.close();
            error ? reject(error) : resolve(result);
        };
        const timer = setTimeout(() => {
            cancel();
            finish(new Error('Offline operation timed out. Try again when your connection is stable.'));
        }, 10 * 60 * 1000);
        signal?.addEventListener('abort', cancel, {once: true});
        channel.port1.onmessage = event => {
            if (event.data.progress) { progress(event.data.progress); return; }
            finish(event.data.error ? new Error(event.data.error) : null, event.data.result);
        };
        channel.port1.onmessageerror = () => { cancel(); finish(new Error('Could not read the offline response. Reload and try again.')); };
        try { registration.active.postMessage({type}, [channel.port2]); }
        catch (error) { finish(error); }
    });
}
