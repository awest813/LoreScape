// Drawing has its own clock so battery settings never delay input/network updates.
export default class FramePacer {
    private next: number = 0;
    private interval: number = 0;

    ready(now: number, fps: number, hidden: boolean): boolean {
        const interval: number = hidden ? 1000 : 1000 / Math.max(1, Math.min(50, fps));
        if (interval !== this.interval) {
            this.interval = interval;
            this.next = now;
        }
        if (now < this.next) return false;
        // Skip missed frames rather than drawing a burst after a suspended tab resumes.
        this.next += (Math.floor((now - this.next) / interval + 1e-7) + 1) * interval;
        return true;
    }
}
