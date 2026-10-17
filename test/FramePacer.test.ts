import FramePacer from '../src/js/jagex2/client/FramePacer';

test.each([15, 30, 50])('paces %i FPS without changing the 50 Hz update clock', (fps: number): void => {
    const pacer: FramePacer = new FramePacer();
    let draws: number = 0;
    for (let now: number = 0; now < 10000; now += 20) if (pacer.ready(now, fps, false)) draws++;
    expect(Math.abs(draws - fps * 10)).toBeLessThanOrEqual(1);
});

test('hidden tabs draw once per second and render immediately on return', (): void => {
    const pacer: FramePacer = new FramePacer();
    let draws: number = 0;
    for (let now: number = 0; now < 10000; now += 20) if (pacer.ready(now, 50, true)) draws++;
    expect(draws).toBe(10);
    expect(pacer.ready(10001, 50, false)).toBe(true);
    expect(pacer.ready(10002, 50, false)).toBe(false);
});

test('suspension does not cause a burst and changing FPS takes effect immediately', (): void => {
    const pacer: FramePacer = new FramePacer();
    expect(pacer.ready(0, 15, false)).toBe(true);
    expect(pacer.ready(600000, 15, false)).toBe(true);
    expect(pacer.ready(600001, 15, false)).toBe(false);
    expect(pacer.ready(600002, 50, false)).toBe(true);
});
