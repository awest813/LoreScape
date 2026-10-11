export async function offlineAction(type, progress = () => {}) {
    if (!isSecureContext || !('serviceWorker' in navigator)) throw new Error('Offline play requires HTTPS or localhost and service worker support');
    if (!(await navigator.serviceWorker.getRegistration('/'))) await navigator.serviceWorker.register('/offline-sw.js');
    const registration = await navigator.serviceWorker.ready;
    return new Promise((resolve, reject) => {
        const channel = new MessageChannel();
        const timer = setTimeout(
            () => {
                channel.port1.close();
                reject(new Error('Offline operation timed out'));
            },
            10 * 60 * 1000
        );
        channel.port1.onmessage = event => {
            if (event.data.progress) {
                progress(event.data.progress);
                return;
            }
            clearTimeout(timer);
            channel.port1.close();
            event.data.error ? reject(new Error(event.data.error)) : resolve(event.data.result);
        };
        registration.active.postMessage({type}, [channel.port2]);
    });
}
