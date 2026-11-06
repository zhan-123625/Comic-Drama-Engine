# -*- coding: utf-8 -*-
"""
High-Fidelity Physical Modeling & Modal Synthesizer for Novel Cinematic BGM.
Generates 6 distinct, atmospheric musical themes for audio dramas / novel videos:
1. forest_whistle.mp3  - 微风竹林 · 笛韵筝鸣 (国风仙侠/自然探险/萌宠日常)
2. playful_comic.mp3   - 萌趣日常 · 欢快木琴与拨弦 (喜剧打闹/搞怪可爱/轻松诙谐)
3. warm_gentle.mp3     - 温暖治愈 · 晨光微漾钢琴 (温馨陪伴/情感羁绊/舒缓安宁)
4. suspense_tension.mp3 - 悬疑紧迫 · 危机低吟脉冲 (悬念危机/潜行调查/紧张对峙)
5. epic_spark.mp3      - 星火浩瀚 · 史诗科幻管弦 (未来科幻/宏大世界观/壮丽高潮)
6. fairytale_dream.mp3 - 纯真梦幻 · 八音盒与竖琴 (童话奇幻/纯真回忆/唯美浪漫)
"""
import math
import os
import subprocess
import wave
import numpy as np

SAMPLE_RATE = 44100
OUT_DIR = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "assets", "bgm"))
os.makedirs(OUT_DIR, exist_ok=True)

# ----------------- Core Physical Modeling Synthesis -----------------

def karplus_strong_pluck(freq, duration_sec, sample_rate=SAMPLE_RATE, decay=0.995, brightness=0.5):
    """Karplus-Strong algorithm for realistic plucked string (Guzheng/Harp/Guitar)"""
    n_samples = int(duration_sec * sample_rate)
    delay_len = max(2, int(sample_rate / freq))
    noise = np.random.uniform(-1.0, 1.0, delay_len).astype(np.float32)
    for i in range(1, len(noise)):
        noise[i] = (1.0 - brightness) * noise[i] + brightness * noise[i-1]
        
    buf = np.zeros(n_samples, dtype=np.float32)
    buf[:delay_len] = noise
    
    for i in range(delay_len, n_samples):
        val = 0.5 * (buf[i - delay_len] + buf[i - delay_len + 1]) * decay
        buf[i] = val
        
    return buf

def acoustic_flute_note(freq, duration_sec, sample_rate=SAMPLE_RATE, amp=0.55):
    """Physical modeling of bamboo flute: breath turbulence + harmonics + natural vibrato"""
    n = int(duration_sec * sample_rate)
    t = np.linspace(0, duration_sec, n, endpoint=False)
    
    # 4.5 Hz natural vibrato, begins gently after 0.15s
    vib_envelope = np.clip((t - 0.15) / 0.4, 0.0, 1.0)
    vib = 1.0 + 0.010 * vib_envelope * np.sin(2 * np.pi * 4.5 * t)
    phase = 2 * np.pi * freq * np.cumsum(vib) / sample_rate
    
    tone = (
        0.72 * np.sin(phase) +
        0.18 * np.sin(2 * phase) +
        0.06 * np.sin(3 * phase) +
        0.02 * np.sin(4 * phase)
    )
    # Breath noise
    noise = np.random.normal(0, 0.015, n)
    tone = tone + noise
    
    att = int(sample_rate * 0.10)
    rel = int(sample_rate * 0.22)
    env = np.ones(n, dtype=np.float32)
    if att > 0 and att < n:
        env[:att] = np.sin(np.linspace(0, np.pi/2, att))
    if rel > 0 and rel < n:
        env[-rel:] = np.cos(np.linspace(0, np.pi/2, rel))
        
    return (tone * env * amp).astype(np.float32)

def piano_note(freq, duration_sec, sample_rate=SAMPLE_RATE, amp=0.5):
    """Resonant piano note: hammer strike + dual detuned strings with exponential decay"""
    n = int(duration_sec * sample_rate)
    t = np.linspace(0, duration_sec, n, endpoint=False)
    
    click_n = min(n, int(0.006 * sample_rate))
    click = np.zeros(n, dtype=np.float32)
    if click_n > 0:
        click[:click_n] = np.random.uniform(-0.15, 0.15, click_n) * np.linspace(1, 0, click_n)
        
    f1 = freq
    f2 = freq * 1.0012
    
    decay_rate = 1.6 + freq * 0.0018
    tone = (
        0.55 * np.sin(2 * np.pi * f1 * t) * np.exp(-t * decay_rate) +
        0.35 * np.sin(2 * np.pi * f2 * t) * np.exp(-t * decay_rate) +
        0.20 * np.sin(2 * np.pi * (f1 * 2) * t) * np.exp(-t * (decay_rate + 2.0)) +
        0.08 * np.sin(2 * np.pi * (f1 * 3) * t) * np.exp(-t * (decay_rate + 4.0)) +
        0.03 * np.sin(2 * np.pi * (f1 * 4) * t) * np.exp(-t * (decay_rate + 7.0))
    )
    return ((tone + click) * amp).astype(np.float32)

def xylophone_note(freq, duration_sec, sample_rate=SAMPLE_RATE, amp=0.6):
    """Wooden marimba / xylophone: sharp wooden transient strike + inharmonic modal resonance"""
    n = int(duration_sec * sample_rate)
    t = np.linspace(0, duration_sec, n, endpoint=False)
    
    # Sharp woody attack click
    click_n = min(n, int(0.004 * sample_rate))
    click = np.zeros(n, dtype=np.float32)
    if click_n > 0:
        click[:click_n] = np.random.uniform(-0.35, 0.35, click_n) * np.linspace(1, 0, click_n)
        
    tone = (
        0.75 * np.sin(2 * np.pi * freq * t) * np.exp(-t * 9.0) +
        0.25 * np.sin(2 * np.pi * (freq * 3.01) * t) * np.exp(-t * 18.0) +
        0.10 * np.sin(2 * np.pi * (freq * 5.98) * t) * np.exp(-t * 28.0)
    )
    return ((tone + click) * amp).astype(np.float32)

def music_box_note(freq, duration_sec, sample_rate=SAMPLE_RATE, amp=0.45):
    """Clear music box tine note: metallic chime with pure harmonics"""
    n = int(duration_sec * sample_rate)
    t = np.linspace(0, duration_sec, n, endpoint=False)
    tone = (
        0.80 * np.sin(2 * np.pi * freq * t) * np.exp(-t * 2.2) +
        0.22 * np.sin(2 * np.pi * freq * 2.76 * t) * np.exp(-t * 4.5) +
        0.10 * np.sin(2 * np.pi * freq * 5.4 * t) * np.exp(-t * 8.0)
    )
    return (tone * amp).astype(np.float32)

def warm_strings_pad(freq, duration_sec, sample_rate=SAMPLE_RATE, amp=0.3):
    """Warm bowed orchestral strings pad: slow attack, rich detuned unison chorus"""
    n = int(duration_sec * sample_rate)
    t = np.linspace(0, duration_sec, n, endpoint=False)
    
    # 3 detuned oscillators for lush string ensemble warmth
    f1 = freq * 0.998
    f2 = freq
    f3 = freq * 1.002
    
    sig = (
        0.4 * np.sin(2 * np.pi * f1 * t) +
        0.4 * np.sin(2 * np.pi * f2 * t) +
        0.4 * np.sin(2 * np.pi * f3 * t) +
        0.2 * np.sin(2 * np.pi * (f2 * 2) * t) +
        0.08 * np.sin(2 * np.pi * (f2 * 3) * t)
    )
    # Slow attack & smooth release
    att = int(sample_rate * 0.4)
    rel = int(sample_rate * 0.5)
    env = np.ones(n, dtype=np.float32)
    if att > 0 and att < n:
        env[:att] = np.sin(np.linspace(0, np.pi/2, att))
    if rel > 0 and rel < n:
        env[-rel:] = np.cos(np.linspace(0, np.pi/2, rel))
        
    return (sig * env * amp).astype(np.float32)

def schroeder_reverb(left, right, sample_rate=SAMPLE_RATE, room_size=0.82, wet=0.32):
    """True Schroeder Stereo Reverb for cinematic spatial depth"""
    comb_delays_l = [int(0.0297 * sample_rate), int(0.0371 * sample_rate), int(0.0411 * sample_rate), int(0.0437 * sample_rate)]
    comb_delays_r = [int(0.0313 * sample_rate), int(0.0359 * sample_rate), int(0.0423 * sample_rate), int(0.0451 * sample_rate)]
    
    def apply_comb(sig, delay_len, feedback):
        out = np.copy(sig)
        for i in range(delay_len, len(out)):
            out[i] += out[i - delay_len] * feedback
        return out

    def apply_allpass(sig, delay_len, g=0.7):
        out = np.zeros_like(sig)
        buf = np.zeros(delay_len, dtype=np.float32)
        idx = 0
        for i in range(len(sig)):
            buf_out = buf[idx]
            in_val = sig[i]
            out[i] = -g * in_val + buf_out
            buf[idx] = in_val + g * out[i]
            idx = (idx + 1) % delay_len
        return out

    rev_l = sum(apply_comb(left, d, room_size) for d in comb_delays_l) * 0.25
    rev_r = sum(apply_comb(right, d, room_size) for d in comb_delays_r) * 0.25
    
    ap1_l = int(0.0050 * sample_rate); ap2_l = int(0.0017 * sample_rate)
    ap1_r = int(0.0053 * sample_rate); ap2_r = int(0.0019 * sample_rate)
    
    rev_l = apply_allpass(apply_allpass(rev_l, ap1_l), ap2_l)
    rev_r = apply_allpass(apply_allpass(rev_r, ap1_r), ap2_r)
    
    out_l = (1.0 - wet) * left + wet * rev_l
    out_r = (1.0 - wet) * right + wet * rev_r
    
    return out_l, out_r

def add_track_note(buffer, note_data, start_sec, sample_rate=SAMPLE_RATE, pan=0.0):
    """Mix note into stereo buffer with panning (-1.0 left to +1.0 right)"""
    start_idx = int(start_sec * sample_rate)
    n = len(note_data)
    if start_idx >= len(buffer[0]):
        return
    end_idx = min(start_idx + n, len(buffer[0]))
    seg_len = end_idx - start_idx
    
    # Constant-power panning
    angle = (pan + 1.0) * (math.pi / 4.0) # 0 to pi/2
    gain_l = math.cos(angle)
    gain_r = math.sin(angle)
    
    buffer[0][start_idx:end_idx] += note_data[:seg_len] * gain_l
    buffer[1][start_idx:end_idx] += note_data[:seg_len] * gain_r

def save_wav_and_mp3(track_name, left, right, sample_rate=SAMPLE_RATE):
    """Normalize, apply reverb, and export to 192kbps MP3"""
    left, right = schroeder_reverb(left, right, sample_rate)
    
    # Soft limiter / normalization to -1.0 dB
    peak = max(np.max(np.abs(left)), np.max(np.abs(right)), 1e-6)
    target_peak = 0.90
    if peak > target_peak:
        scale = target_peak / peak
        left *= scale
        right *= scale
        
    wav_path = os.path.join(OUT_DIR, f"{track_name}.wav")
    mp3_path = os.path.join(OUT_DIR, f"{track_name}.mp3")
    
    # Write 16-bit WAV
    left_int16 = (np.clip(left, -1.0, 1.0) * 32767).astype(np.int16)
    right_int16 = (np.clip(right, -1.0, 1.0) * 32767).astype(np.int16)
    stereo_interleaved = np.empty((len(left) * 2,), dtype=np.int16)
    stereo_interleaved[0::2] = left_int16
    stereo_interleaved[1::2] = right_int16
    
    with wave.open(wav_path, "wb") as wf:
        wf.setnchannels(2)
        wf.setsampwidth(2)
        wf.setframerate(sample_rate)
        wf.writeframes(stereo_interleaved.tobytes())
        
    # Convert to MP3 using ffmpeg
    ffmpeg_bin = "C:/Users/Administrator/AppData/Local/Programs/Python/Python310/lib/site-packages/imageio_ffmpeg/binaries/ffmpeg-win-x86_64-v9.0.2.exe"
    if not os.path.exists(ffmpeg_bin):
        ffmpeg_bin = "ffmpeg"
    cmd = [ffmpeg_bin, "-y", "-i", wav_path, "-codec:a", "libmp3lame", "-b:a", "192k", mp3_path]
    subprocess.run(cmd, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, check=True)
    if os.path.exists(wav_path):
        os.remove(wav_path)
    print(f"Generated: {mp3_path} ({os.path.getsize(mp3_path):,} bytes)")

# ----------------- Theme 1: 微风竹林 · 笛韵筝鸣 (forest_whistle) -----------------
def generate_forest_whistle():
    """Chinese bamboo forest: Acoustic Karplus Guzheng chords + expressive bamboo flute melody"""
    dur = 22.0
    n = int(dur * SAMPLE_RATE)
    buf = [np.zeros(n, dtype=np.float32), np.zeros(n, dtype=np.float32)]
    
    # Pentatonic notes in D major: D, E, F#, A, B
    # Frequencies (Hz)
    D3, E3, Fs3, A3, B3 = 146.8, 164.8, 185.0, 220.0, 246.9
    D4, E4, Fs4, A4, B4 = 293.7, 329.6, 370.0, 440.0, 493.9
    D5, E5, Fs5, A5 = 587.3, 659.3, 740.0, 880.0
    
    # 1. Warm String Bed (Soft Guzheng low resonances)
    string_progression = [
        (0.0, [D3, A3, D4], 5.0),
        (5.0, [B3, Fs4, B4], 5.0),
        (10.0, [A3, E4, A4], 5.0),
        (15.0, [D3, A3, Fs4, D5], 7.0),
    ]
    for start, chord, chord_dur in string_progression:
        for f in chord:
            note = warm_strings_pad(f, chord_dur, amp=0.18)
            add_track_note(buf, note, start, pan=0.0)
            
    # 2. Guzheng Plucks (Flowing water / arpeggio)
    guzheng_pattern = [
        # Measure 1
        (0.2, D4, -0.4), (0.6, Fs4, 0.3), (1.0, A4, -0.2), (1.4, D5, 0.4),
        (2.0, B4, -0.3), (2.6, A4, 0.2), (3.2, Fs4, -0.2), (4.0, D4, 0.1),
        # Measure 2
        (5.2, B3, -0.4), (5.7, D4, 0.2), (6.2, Fs4, -0.3), (6.8, B4, 0.4),
        (7.4, A4, -0.2), (8.0, Fs4, 0.3), (8.8, E4, -0.1), (9.5, D4, 0.2),
        # Measure 3
        (10.2, A3, -0.3), (10.7, E4, 0.3), (11.2, A4, -0.4), (11.8, B4, 0.3),
        (12.5, D5, 0.4), (13.2, B4, -0.2), (13.9, A4, 0.1), (14.6, Fs4, -0.3),
        # Measure 4
        (15.2, D4, -0.4), (15.7, Fs4, 0.3), (16.3, A4, -0.2), (17.0, D5, 0.4),
        (17.8, E5, 0.2), (18.6, D5, -0.3), (19.4, A4, 0.1), (20.2, D4, 0.0),
    ]
    for start, f, pan in guzheng_pattern:
        pluck = karplus_strong_pluck(f, 3.5, decay=0.995, brightness=0.6)
        add_track_note(buf, pluck * 0.38, start, pan=pan)
        
    # 3. Expressive Bamboo Flute (Main Melody)
    flute_melody = [
        (1.0, D5, 1.8),
        (3.0, E5, 1.4),
        (4.5, Fs5, 2.2),
        (7.0, E5, 1.2),
        (8.4, D5, 2.0),
        (11.0, Fs5, 1.6),
        (12.8, A5, 2.0),
        (15.0, Fs5, 1.5),
        (16.8, E5, 1.4),
        (18.4, D5, 3.0),
    ]
    for start, f, note_dur in flute_melody:
        note = acoustic_flute_note(f, note_dur, amp=0.52)
        add_track_note(buf, note, start, pan=0.1)
        
    save_wav_and_mp3("forest_whistle", buf[0], buf[1])

# ----------------- Theme 2: 萌趣日常 · 欢快木琴与拨弦 (playful_comic) -----------------
def generate_playful_comic():
    """Cute comic comedy: Crisp wooden xylophone + bouncy pizzicato bassline"""
    dur = 18.0
    n = int(dur * SAMPLE_RATE)
    buf = [np.zeros(n, dtype=np.float32), np.zeros(n, dtype=np.float32)]
    
    C3, D3, E3, G3, A3 = 130.8, 146.8, 164.8, 196.0, 220.0
    C4, D4, E4, G4, A4 = 261.6, 293.7, 329.6, 392.0, 440.0
    C5, D5, E5, G5, A5 = 523.3, 587.3, 659.3, 784.0, 880.0
    
    # 1. Bouncy pizzicato bassline (Karplus-Strong tuned punchy)
    bass_notes = [
        (0.0, C3), (0.5, G3), (1.0, C3), (1.5, E3),
        (2.0, D3), (2.5, A3), (3.0, D3), (3.5, Fs3 if 'Fs3' in locals() else 185.0),
        (4.0, G3), (4.5, D3), (5.0, G3), (5.5, B3 if 'B3' in locals() else 246.9),
        (6.0, C3), (6.5, G3), (7.0, C3), (7.5, G3),
    ]
    # Repeat for two cycles
    for loop_offset in [0.0, 8.0]:
        for start, f in bass_notes:
            if start + loop_offset < 16.5:
                note = karplus_strong_pluck(f, 0.45, decay=0.985, brightness=0.7)
                add_track_note(buf, note * 0.42, start + loop_offset, pan=-0.2)
                
    # 2. Crisp wooden xylophone melody
    xylo_melody = [
        (0.2, E5, -0.3), (0.45, G5, 0.3), (0.7, A5, -0.1), (1.1, G5, 0.2),
        (1.5, E5, -0.3), (1.8, D5, 0.1), (2.2, C5, -0.2), (2.7, D5, 0.3),
        (3.1, E5, -0.1), (3.5, E5, 0.2), (3.8, D5, -0.3), (4.2, C5, 0.1),
        (4.7, G5, 0.4), (5.1, E5, -0.2), (5.5, C5, 0.1), (6.0, D5, -0.3),
        (6.5, C5, 0.0), (7.1, C5, 0.2),
        
        # Second phrase with comical leaps
        (8.2, G5, 0.3), (8.45, A5, -0.3), (8.7, G5, 0.1), (9.1, E5, -0.2),
        (9.5, G5, 0.4), (9.8, A5, -0.2), (10.2, C5*2, 0.3), (10.7, A5, -0.1),
        (11.2, G5, 0.2), (11.6, E5, -0.3), (12.1, D5, 0.1), (12.6, C5, -0.2),
        (13.2, E5, 0.3), (13.7, D5, -0.1), (14.3, C5, 0.0), (15.0, C5, 0.0),
    ]
    for start, f, pan in xylo_melody:
        note = xylophone_note(f, 0.6, amp=0.55)
        add_track_note(buf, note, start, pan=pan)
        
    save_wav_and_mp3("playful_comic", buf[0], buf[1])

# ----------------- Theme 3: 温暖治愈 · 晨光微漾钢琴 (warm_gentle) -----------------
def generate_warm_gentle():
    """Warm healing piano: Resonant acoustic grand piano arpeggios + warm string swell"""
    dur = 20.0
    n = int(dur * SAMPLE_RATE)
    buf = [np.zeros(n, dtype=np.float32), np.zeros(n, dtype=np.float32)]
    
    # Frequencies: F Major / D Minor heartfelt progression
    F3, A3, C4, E4, F4, G4, A4, C5 = 174.6, 220.0, 261.6, 329.6, 349.2, 392.0, 440.0, 523.3
    D3, D4, Bb3, Bb4 = 146.8, 293.7, 233.1, 466.2
    
    # 1. Warm String Bed
    chords = [
        (0.0, [F3, C4, A4], 5.5),
        (5.0, [D3, A3, F4], 5.5),
        (10.0, [Bb3, F4, D4], 5.5),
        (15.0, [F3, C4, A4, C5], 5.5),
    ]
    for start, chord_notes, c_dur in chords:
        for f in chord_notes:
            pad = warm_strings_pad(f, c_dur, amp=0.15)
            add_track_note(buf, pad, start, pan=0.0)
            
    # 2. Resonant Acoustic Piano Arpeggio
    piano_pattern = [
        # Chord 1: F major
        (0.2, F3, -0.3), (0.7, C4, 0.2), (1.2, A4, -0.1), (1.8, C5, 0.3),
        (2.4, A4, -0.2), (3.0, F4, 0.1), (3.6, G4, -0.3), (4.2, A4, 0.2),
        # Chord 2: D minor
        (5.2, D3, -0.3), (5.7, A3, 0.2), (6.2, F4, -0.2), (6.8, A4, 0.3),
        (7.4, D4, -0.1), (8.0, F4, 0.2), (8.6, E4, -0.2), (9.2, D4, 0.1),
        # Chord 3: Bb major
        (10.2, Bb3, -0.3), (10.7, F4, 0.2), (11.2, Bb4, 0.3), (11.8, D4, -0.2),
        (12.4, F4, 0.1), (13.0, G4, -0.2), (13.6, A4, 0.3), (14.2, F4, -0.1),
        # Chord 4: F gentle resolve
        (15.2, F3, -0.3), (15.7, C4, 0.2), (16.2, A4, 0.3), (16.8, C5, -0.2),
        (17.5, F4, 0.1), (18.3, C5, 0.0),
    ]
    for start, f, pan in piano_pattern:
        note = piano_note(f, 3.2, amp=0.48)
        add_track_note(buf, note, start, pan=pan)
        
    save_wav_and_mp3("warm_gentle", buf[0], buf[1])

# ----------------- Theme 4: 悬疑紧迫 · 危机低吟脉冲 (suspense_tension) -----------------
def generate_suspense_tension():
    """Suspense & Mystery: Deep bowed cello drone + low heartbeat pulse + metallic bell tines"""
    dur = 18.0
    n = int(dur * SAMPLE_RATE)
    buf = [np.zeros(n, dtype=np.float32), np.zeros(n, dtype=np.float32)]
    
    A1, A2, E2, C3, Eb3 = 55.0, 110.0, 82.4, 130.8, 155.6
    A4, Eb5, F5 = 440.0, 622.3, 698.5
    
    # 1. Dark drone
    drone1 = warm_strings_pad(A1, 18.0, amp=0.28)
    drone2 = warm_strings_pad(A2, 18.0, amp=0.20)
    add_track_note(buf, drone1, 0.0, pan=-0.2)
    add_track_note(buf, drone2, 0.0, pan=0.2)
    
    # 2. Rhythmic tension pulse (every 0.9s)
    for i in range(18):
        t_sec = i * 0.9
        if t_sec < 16.5:
            # Low thud pulse
            thud = karplus_strong_pluck(A1, 0.6, decay=0.97, brightness=0.2)
            add_track_note(buf, thud * 0.45, t_sec, pan=0.0)
            
    # 3. Mysterious metallic tines (Tritone intervals for suspense)
    myst_notes = [
        (1.5, Eb5, 0.4), (3.8, A4, -0.4), (6.2, F5, 0.3), (8.5, Eb5, -0.3),
        (11.0, A4, 0.2), (13.2, Eb5, -0.4), (15.0, F5, 0.3)
    ]
    for start, f, pan in myst_notes:
        note = music_box_note(f, 2.5, amp=0.35)
        add_track_note(buf, note, start, pan=pan)
        
    save_wav_and_mp3("suspense_tension", buf[0], buf[1])

# ----------------- Theme 5: 星火浩瀚 · 史诗科幻管弦 (epic_spark) -----------------
def generate_epic_spark():
    """Epic futuristic adventure: Brass synth swells + rhythmic staccato pulse (Star Beacon)"""
    dur = 20.0
    n = int(dur * SAMPLE_RATE)
    buf = [np.zeros(n, dtype=np.float32), np.zeros(n, dtype=np.float32)]
    
    C2, G2, C3, Eb3, G3, Bb3, C4, G4 = 65.4, 98.0, 130.8, 155.6, 196.0, 233.1, 261.6, 392.0
    
    # 1. Soaring Epic Pad Progression (C minor -> Ab -> Bb -> C minor)
    chords = [
        (0.0, [C2, G2, C3, G3, Eb3], 5.0),
        (5.0, [82.4, 164.8, 207.7], 5.0), # Ab
        (10.0, [116.5, 233.1, 293.7], 5.0), # Bb
        (15.0, [C2, G2, C3, G3, C4], 5.0),
    ]
    for start, chord_notes, c_dur in chords:
        for f in chord_notes:
            pad = warm_strings_pad(f, c_dur, amp=0.22)
            add_track_note(buf, pad, start, pan=0.0)
            
    # 2. Driving Cinematic Pulse (16th notes / 0.25s)
    for i in range(68):
        t_sec = 1.0 + i * 0.25
        if t_sec < 18.0:
            pitch = C3 if (i % 8 < 6) else G3
            pulse = karplus_strong_pluck(pitch, 0.22, decay=0.98, brightness=0.55)
            add_track_note(buf, pulse * 0.32, t_sec, pan=(0.2 if i % 2 == 0 else -0.2))
            
    # 3. Heroic Lead Melodic Chords
    lead = [
        (2.0, G4, 2.0), (4.5, C4*2, 2.5),
        (7.0, Bb3*2, 1.8), (9.0, G4, 2.2),
        (12.0, C4*2, 3.0), (15.5, G4, 3.5)
    ]
    for start, f, l_dur in lead:
        note = piano_note(f, l_dur, amp=0.45)
        add_track_note(buf, note, start, pan=0.1)
        
    save_wav_and_mp3("epic_spark", buf[0], buf[1])

# ----------------- Theme 6: 纯真童话 · 梦幻八音盒与竖琴 (fairytale_dream) -----------------
def generate_fairytale_dream():
    """Pure fairytale dream: Gentle music box + flowing harp arpeggios"""
    dur = 18.0
    n = int(dur * SAMPLE_RATE)
    buf = [np.zeros(n, dtype=np.float32), np.zeros(n, dtype=np.float32)]
    
    G3, B3, D4, G4, B4, D5, G5 = 196.0, 246.9, 293.7, 392.0, 493.9, 587.3, 784.0
    C4, E4, G4, C5, E5 = 261.6, 329.6, 392.0, 523.3, 659.3
    
    # Harp arpeggios
    harp_pattern = [
        (0.0, G3, -0.3), (0.4, D4, 0.2), (0.8, G4, -0.2), (1.2, B4, 0.3), (1.6, D5, -0.1),
        (2.2, C4, -0.3), (2.6, E4, 0.2), (3.0, G4, -0.2), (3.4, C5, 0.3), (3.8, E5, 0.1),
        (4.4, G3, -0.3), (4.8, D4, 0.2), (5.2, G4, -0.2), (5.6, B4, 0.3), (6.0, D5, -0.1),
        (6.6, C4, -0.3), (7.0, E4, 0.2), (7.4, G4, -0.2), (7.8, C5, 0.3), (8.2, E5, 0.1),
        # Second cycle
        (9.0, G3, -0.3), (9.4, D4, 0.2), (9.8, G4, -0.2), (10.2, B4, 0.3), (10.6, D5, -0.1),
        (11.2, C4, -0.3), (11.6, E4, 0.2), (12.0, G4, -0.2), (12.4, C5, 0.3), (12.8, E5, 0.1),
        (13.4, G3, -0.3), (14.0, D4, 0.2), (14.8, B4, 0.0), (15.6, G5, 0.0),
    ]
    for start, f, pan in harp_pattern:
        pluck = karplus_strong_pluck(f, 2.5, decay=0.992, brightness=0.45)
        add_track_note(buf, pluck * 0.35, start, pan=pan)
        
    # Music Box Melody
    mbox_melody = [
        (0.5, G5, 0.2), (1.2, B4, -0.2), (1.8, D5, 0.1), (2.5, E5, 0.3),
        (3.4, G5, -0.1), (4.2, D5, 0.2), (5.0, B4, -0.2), (6.0, A4 if 'A4' in locals() else 440.0, 0.1),
        (7.0, G4, 0.0), (9.5, G5, 0.2), (10.4, E5, -0.2), (11.2, D5, 0.3),
        (12.2, B4, -0.1), (13.5, G5, 0.0)
    ]
    for start, f, pan in mbox_melody:
        note = music_box_note(f, 2.0, amp=0.45)
        add_track_note(buf, note, start, pan=pan)
        
    save_wav_and_mp3("fairytale_dream", buf[0], buf[1])

if __name__ == "__main__":
    print("Generating high-fidelity novel BGM presets...")
    generate_forest_whistle()
    generate_playful_comic()
    generate_warm_gentle()
    generate_suspense_tension()
    generate_epic_spark()
    generate_fairytale_dream()
    print("All novel BGM presets generated successfully!")
