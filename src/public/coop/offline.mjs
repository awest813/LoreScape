export async function offlineAction(type, progress = () => {}, signal) {
    if (!isSecureContext || !('serviceWorker' in navigator)) throw new Error('Offline play requires HTTPS or localhost and service worker support');
    signal?.throwIfAborted();
    const existing = await navigator.serviceWorker.getRegistration('/');
    if (existing) existing.update().catch(() => {});
    else await navigator.serviceWorker.register('/offline-sw.js');
    let startupTimer;
    const registration = await Promise.race([
        navigator.serviceWorker.ready,
        new Promise((_, reject) => { startupTimer = setTimeout(() => reject(new Error('Offline setup timed out. Reload and try again.')), 30000); })
    ]).finally(() => clearTimeout(startupTimer));
    signal?.throwIfAborted();
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
