# -*- coding: utf-8 -*-
"""
Generate high quality ambient instrumental BGM presets for Comic-Drama-Engine.
Creates:
1. forest_whistle.wav / .mp3 - 轻快温馨的竹笛与微风弦乐 (C Major Pentatonic)
2. playful_comic.wav / .mp3  - 轻松逗趣的搞怪木琴与跳跃拨弦 (Bouncing pentatonic)
3. warm_gentle.wav / .mp3    - 温暖治愈的柔和钢琴与阳光氛围 (Peaceful chords)
"""
import math
import os
import wave
import numpy as np

SAMPLE_RATE = 44100

def envelope(n_samples, attack=0.05, decay=0.1, sustain=0.7, release=0.2):
    """ADSR envelope"""
    att_samples = int(n_samples * attack)
    dec_samples = int(n_samples * decay)
    rel_samples = int(n_samples * release)
    sus_samples = n_samples - att_samples - dec_samples - rel_samples
    if sus_samples < 0:
        att_samples = int(n_samples * 0.3)
        dec_samples = int(n_samples * 0.2)
        rel_samples = int(n_samples * 0.5)
        sus_samples = 0
    
    env = np.ones(n_samples, dtype=np.float32)
    if att_samples > 0:
        env[:att_samples] = np.linspace(0, 1.0, att_samples)
    if dec_samples > 0:
        env[att_samples:att_samples+dec_samples] = np.linspace(1.0, sustain, dec_samples)
    if sus_samples > 0:
        env[att_samples+dec_samples:att_samples+dec_samples+sus_samples] = sustain
    if rel_samples > 0:
        env[-rel_samples:] = np.linspace(sustain, 0, rel_samples)
    return env

def gen_flute_note(freq, duration, amp=0.5):
    """Bamboo flute tone: fundamental + subtle 2nd/3rd harmonics + gentle vibrato"""
    n = int(SAMPLE_RATE * duration)
    t = np.linspace(0, duration, n, endpoint=False)
    # 5Hz vibrato
    vib = 1.0 + 0.008 * np.sin(2 * np.pi * 5.0 * t)
    phase = 2 * np.pi * freq * np.cumsum(vib) / SAMPLE_RATE
    wave_data = (
        0.75 * np.sin(phase) +
        0.20 * np.sin(2 * phase) +
        0.05 * np.sin(3 * phase)
    )
    env = envelope(n, attack=0.15, decay=0.1, sustain=0.8, release=0.25)
    return (wave_data * env * amp).astype(np.float32)

def gen_pluck_note(freq, duration, amp=0.4):
    """Acoustic guitar / harp pluck tone"""
    n = int(SAMPLE_RATE * duration)
    t = np.linspace(0, duration, n, endpoint=False)
    # Pluck decay
    decay_curve = np.exp(-t * (4.0 + freq / 200.0))
    wave_data = (
        0.65 * np.sin(2 * np.pi * freq * t) +
        0.25 * np.sin(2 * np.pi * 2 * freq * t) +
        0.10 * np.sin(2 * np.pi * 3 * freq * t)
    )
    return (wave_data * decay_curve * amp).astype(np.float32)

def gen_marimba_note(freq, duration, amp=0.4):
    """Playful xylophone / marimba tone"""
    n = int(SAMPLE_RATE * duration)
    t = np.linspace(0, duration, n, endpoint=False)
    decay_curve = np.exp(-t * 9.0)
    wave_data = (
        0.80 * np.sin(2 * np.pi * freq * t) +
        0.18 * np.sin(2 * np.pi * 4 * freq * t) +
        0.02 * np.sin(2 * np.pi * 9 * freq * t)
    )
    return (wave_data * decay_curve * amp).astype(np.float32)

def gen_warm_pad(freq, duration, amp=0.25):
    """Soft ambient pad / strings"""
    n = int(SAMPLE_RATE * duration)
    t = np.linspace(0, duration, n, endpoint=False)
    # Slow detuned chorus
    wave_data = (
        0.50 * np.sin(2 * np.pi * freq * t) +
        0.25 * np.sin(2 * np.pi * (freq * 1.004) * t) +
        0.25 * np.sin(2 * np.pi * (freq * 0.996) * t)
    )
    env = envelope(n, attack=0.35, decay=0.1, sustain=0.7, release=0.35)
    return (wave_data * env * amp).astype(np.float32)

def note_freq(name_with_oct):
    """e.g. C4 -> 261.63, A4 -> 440.0"""
    notes = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"]
    note = name_with_oct[:-1]
    octave = int(name_with_oct[-1])
    idx = notes.index(note)
    midi = 12 + octave * 12 + idx
    return 440.0 * (2.0 ** ((midi - 69) / 12.0))

def save_wav(filename, left, right):
    # Normalize with headroom
    peak = max(np.max(np.abs(left)), np.max(np.abs(right)), 1e-6)
    scale = 0.85 / peak
    left_int = np.int16(np.clip(left * scale * 32767, -32768, 32767))
    right_int = np.int16(np.clip(right * scale * 32767, -32768, 32767))
    interleaved = np.empty((len(left_int) * 2,), dtype=np.int16)
    interleaved[0::2] = left_int
    interleaved[1::2] = right_int

    with wave.open(filename, 'w') as wf:
        wf.setnchannels(2)
        wf.setsampwidth(2)
        wf.setframerate(SAMPLE_RATE)
        wf.writeframes(interleaved.tobytes())

def generate_forest_whistle(out_path):
    """
    16-second seamless atmospheric flute & harp in Pentatonic scale:
    C4, D4, E4, G4, A4, C5, D5, E5, G5, A5
    """
    total_sec = 20.0
    total_len = int(SAMPLE_RATE * total_sec)
    left = np.zeros(total_len, dtype=np.float32)
    right = np.zeros(total_len, dtype=np.float32)

    # 1. Warm backing chords (C - G - Am - F)
    prog = [
        ("C3", "G3", "E4", 0.0, 5.0),
        ("G2", "G3", "D4", 5.0, 5.0),
        ("A2", "E3", "C4", 10.0, 5.0),
        ("F2", "C3", "A3", 15.0, 5.0),
    ]
    for n1, n2, n3, st, dur in prog:
        s_idx = int(st * SAMPLE_RATE)
        p1 = gen_warm_pad(note_freq(n1), dur, 0.18)
        p2 = gen_warm_pad(note_freq(n2), dur, 0.15)
        p3 = gen_warm_pad(note_freq(n3), dur, 0.12)
        e_idx = min(total_len, s_idx + len(p1))
        chunk_len = e_idx - s_idx
        left[s_idx:e_idx] += (p1[:chunk_len] * 0.7 + p2[:chunk_len] * 0.3)
        right[s_idx:e_idx] += (p2[:chunk_len] * 0.3 + p3[:chunk_len] * 0.7)

    # 2. Gentle harp / pluck pattern
    harp_notes = [
        ("C4", 0.0), ("E4", 0.5), ("G4", 1.0), ("C5", 1.5),
        ("G4", 2.0), ("E4", 2.5), ("G4", 3.0), ("D4", 3.5),
        ("D4", 5.0), ("G4", 5.5), ("B4", 6.0), ("D5", 6.5),
        ("B4", 7.0), ("G4", 7.5), ("A4", 8.0), ("G4", 8.5),
        ("A3", 10.0), ("E4", 10.5), ("A4", 11.0), ("C5", 11.5),
        ("E5", 12.0), ("C5", 12.5), ("A4", 13.0), ("E4", 13.5),
        ("F3", 15.0), ("C4", 15.5), ("F4", 16.0), ("A4", 16.5),
        ("C5", 17.0), ("A4", 17.5), ("F4", 18.0), ("G4", 18.5),
    ]
    for n, st in harp_notes:
        s_idx = int(st * SAMPLE_RATE)
        sample = gen_pluck_note(note_freq(n), 1.2, 0.22)
        e_idx = min(total_len, s_idx + len(sample))
        chunk_len = e_idx - s_idx
        pan = 0.4 + 0.2 * math.sin(st)
        left[s_idx:e_idx] += sample[:chunk_len] * (1.0 - pan)
        right[s_idx:e_idx] += sample[:chunk_len] * pan

    # 3. Expressive Bamboo Flute melody (Tuantuan forest theme)
    flute_melody = [
        ("E5", 1.0, 1.2), ("G5", 2.3, 0.8), ("A5", 3.2, 1.5),
        ("G5", 5.2, 1.0), ("E5", 6.3, 0.8), ("D5", 7.2, 2.0),
        ("C5", 10.0, 1.2), ("D5", 11.3, 0.8), ("E5", 12.2, 1.2), ("G5", 13.5, 1.5),
        ("A5", 15.2, 1.0), ("G5", 16.3, 0.8), ("E5", 17.2, 1.0), ("D5", 18.3, 1.4),
    ]
    for n, st, dur in flute_melody:
        s_idx = int(st * SAMPLE_RATE)
        sample = gen_flute_note(note_freq(n), dur, 0.40)
        e_idx = min(total_len, s_idx + len(sample))
        chunk_len = e_idx - s_idx
        left[s_idx:e_idx] += sample[:chunk_len] * 0.52
        right[s_idx:e_idx] += sample[:chunk_len] * 0.48

    save_wav(out_path, left, right)

def generate_playful_comic(out_path):
    """Playful cartoon marimba & bouncing bass (Gungun & Tuantuan funny moments)"""
    total_sec = 16.0
    total_len = int(SAMPLE_RATE * total_sec)
    left = np.zeros(total_len, dtype=np.float32)
    right = np.zeros(total_len, dtype=np.float32)

    # Bouncing bass (C - G - C - G)
    for beat in range(32):
        st = beat * 0.5
        note = "C3" if (beat // 4) % 2 == 0 else "G2"
        if beat % 2 == 1:
            note = "E3" if (beat // 4) % 2 == 0 else "D3"
        s_idx = int(st * SAMPLE_RATE)
        sample = gen_marimba_note(note_freq(note), 0.4, 0.30)
        e_idx = min(total_len, s_idx + len(sample))
        chunk_len = e_idx - s_idx
        left[s_idx:e_idx] += sample[:chunk_len] * 0.6
        right[s_idx:e_idx] += sample[:chunk_len] * 0.4

    # Lively Marimba melody
    marimba_notes = [
        ("G4", 0.0), ("C5", 0.25), ("E5", 0.5), ("G5", 0.75), ("E5", 1.0), ("C5", 1.25),
        ("A4", 2.0), ("C5", 2.25), ("D5", 2.5), ("B4", 3.0),
        ("G4", 4.0), ("D5", 4.25), ("F5", 4.5), ("D5", 5.0), ("B4", 5.25), ("G4", 5.5),
        ("C5", 6.0), ("E5", 6.25), ("G5", 6.5), ("C6", 7.0),
        ("A5", 8.0), ("G5", 8.5), ("F5", 9.0), ("E5", 9.5),
        ("D5", 10.0), ("E5", 10.5), ("F5", 11.0), ("G5", 11.5),
        ("E5", 12.0), ("C5", 12.5), ("D5", 13.0), ("G4", 13.5),
        ("C5", 14.0), ("C5", 14.5),
    ]
    for n, st in marimba_notes:
        s_idx = int(st * SAMPLE_RATE)
        sample = gen_marimba_note(note_freq(n), 0.6, 0.42)
        e_idx = min(total_len, s_idx + len(sample))
        chunk_len = e_idx - s_idx
        pan = 0.35 + 0.3 * math.sin(st * 2.0)
        left[s_idx:e_idx] += sample[:chunk_len] * (1.0 - pan)
        right[s_idx:e_idx] += sample[:chunk_len] * pan

    save_wav(out_path, left, right)

def generate_warm_gentle(out_path):
    """Gentle peaceful piano & soft strings (Sunlight & Healing atmosphere)"""
    total_sec = 18.0
    total_len = int(SAMPLE_RATE * total_sec)
    left = np.zeros(total_len, dtype=np.float32)
    right = np.zeros(total_len, dtype=np.float32)

    # Soft ambient string beds
    chords = [
        ("F3", "A3", "C4", "E4", 0.0, 4.5),
        ("G3", "B3", "D4", "G4", 4.5, 4.5),
        ("E3", "G3", "B3", "E4", 9.0, 4.5),
        ("A3", "C4", "E4", "A4", 13.5, 4.5),
    ]
    for n1, n2, n3, n4, st, dur in chords:
        s_idx = int(st * SAMPLE_RATE)
        p1 = gen_warm_pad(note_freq(n1), dur, 0.16)
        p2 = gen_warm_pad(note_freq(n2), dur, 0.14)
        p3 = gen_warm_pad(note_freq(n3), dur, 0.12)
        p4 = gen_warm_pad(note_freq(n4), dur, 0.10)
        e_idx = min(total_len, s_idx + len(p1))
        chunk_len = e_idx - s_idx
        left[s_idx:e_idx] += (p1[:chunk_len] + p2[:chunk_len]) * 0.5
        right[s_idx:e_idx] += (p3[:chunk_len] + p4[:chunk_len]) * 0.5

    # Gentle Piano arpeggio
    arps = [
        ("F4", 0.0), ("C5", 0.6), ("E5", 1.2), ("A5", 1.8), ("E5", 2.4), ("C5", 3.0),
        ("G4", 4.5), ("D5", 5.1), ("G5", 5.7), ("B5", 6.3), ("G5", 6.9), ("D5", 7.5),
        ("E4", 9.0), ("B4", 9.6), ("E5", 10.2), ("G5", 10.8), ("E5", 11.4), ("B4", 12.0),
        ("A4", 13.5), ("E5", 14.1), ("A5", 14.7), ("C6", 15.3), ("A5", 15.9), ("E5", 16.5),
    ]
    for n, st in arps:
        s_idx = int(st * SAMPLE_RATE)
        sample = gen_pluck_note(note_freq(n), 1.8, 0.35)
        e_idx = min(total_len, s_idx + len(sample))
        chunk_len = e_idx - s_idx
        pan = 0.5 + 0.25 * math.sin(st * 1.5)
        left[s_idx:e_idx] += sample[:chunk_len] * (1.0 - pan)
        right[s_idx:e_idx] += sample[:chunk_len] * pan

    save_wav(out_path, left, right)

def main():
    bgm_dir = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "assets", "bgm"))
    os.makedirs(bgm_dir, exist_ok=True)

    print("Generating forest_whistle.wav...")
    generate_forest_whistle(os.path.join(bgm_dir, "forest_whistle.wav"))

    print("Generating playful_comic.wav...")
    generate_playful_comic(os.path.join(bgm_dir, "playful_comic.wav"))

    print("Generating warm_gentle.wav...")
    generate_warm_gentle(os.path.join(bgm_dir, "warm_gentle.wav"))

    print("All BGM WAV presets generated successfully!")

if __name__ == "__main__":
    main()
