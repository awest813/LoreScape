let waveGain;
let muted = false;
let waveVolume = 192;
let midiVolume = 256;

export function setAudioMuted(value) {
    muted = value;
    setWaveVolume(waveVolume);
    setMidiVolume(midiVolume);
    if (muted) stopMidi(false);
}

export async function playWave(data, vol) {
    if (muted) return;
    setWaveVolume(vol);

    try {
        const audioBuffer = await window.audioContext.decodeAudioData(Uint8Array.from(data).buffer);
        let bufferSource = window.audioContext.createBufferSource();
        bufferSource.buffer = audioBuffer;
        bufferSource.connect(waveGain);
        bufferSource.start();
    } catch (err) {
        console.log(err);
    }
}

export function setWaveVolume(vol) {
    waveVolume = vol;
    if (!waveGain) {
        waveGain = window.audioContext.createGain();
        waveGain.connect(window.audioContext.destination);
    }

    waveGain.gain.value = muted ? 0 : vol / 256;
}

export function playMidi(data, vol, fade) {
    midiVolume = vol;
    if (muted) return;
    if (window._tinyMidiPlay) {
        window._tinyMidiPlay(data, vol / 256, fade);
    }
}

export function setMidiVolume(vol) {
    midiVolume = vol;
    if (window._tinyMidiVolume) {
        window._tinyMidiVolume(muted ? 0 : vol / 256);
    }
}

export function stopMidi(fade) {
    if (window._tinyMidiStop) {
        window._tinyMidiStop(fade);
    }
}
