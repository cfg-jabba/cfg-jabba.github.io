#!/usr/bin/env python3
"""Generates every sound in Frogs in the Sky procedurally (royalty-free, ours to ship on Steam).

Design rules: soft attacks, everything low-passed (<= ~5 kHz), peaks well under 0 dBFS,
no piercing tones. Run:  python3 tools/gen_audio.py  (needs numpy)
"""
import os, wave
import numpy as np

SR = 32000
OUT = os.path.join(os.path.dirname(__file__), "..", "assets", "audio")
rng = np.random.default_rng(7)


def t(d):
    return np.arange(int(SR * d)) / SR


def lowpass(x, cutoff):
    # one-pole, applied 2x for a gentle 12 dB/oct slope
    a = np.exp(-2 * np.pi * cutoff / SR)
    for _ in range(2):
        y = np.empty_like(x)
        acc = 0.0
        for i, v in enumerate(x):
            acc = (1 - a) * v + a * acc
            y[i] = acc
        x = y
    return x


def lp_fast(x, cutoff):
    # FFT brickwall-ish smooth low-pass (fast for long buffers)
    X = np.fft.rfft(x)
    f = np.fft.rfftfreq(len(x), 1 / SR)
    X *= 1 / (1 + (f / cutoff) ** 4)
    return np.fft.irfft(X, len(x))


def hp_fast(x, cutoff):
    X = np.fft.rfft(x)
    f = np.fft.rfftfreq(len(x), 1 / SR)
    X *= 1 - 1 / (1 + (f / max(cutoff, 1)) ** 4)
    return np.fft.irfft(X, len(x))


def bandpass(x, lo, hi):
    return lp_fast(hp_fast(x, lo), hi)


def env(n, a=0.01, r=0.2, curve=3.0):
    e = np.ones(n)
    na = max(1, int(a * SR))
    e[:na] = np.linspace(0, 1, na) ** 2
    nr = min(n, max(1, int(r * SR)))
    e[-nr:] *= np.linspace(1, 0, nr) ** curve
    return e


def norm(x, peak_db=-6.0):
    m = np.max(np.abs(x)) + 1e-9
    return x / m * (10 ** (peak_db / 20))


def save(name, x, peak_db=-6.0, cutoff=5500):
    x = lp_fast(x, cutoff)
    x = norm(x, peak_db)
    os.makedirs(OUT, exist_ok=True)
    data = (np.clip(x, -1, 1) * 32767).astype(np.int16)
    with wave.open(os.path.join(OUT, name + ".wav"), "wb") as w:
        w.setnchannels(1)
        w.setsampwidth(2)
        w.setframerate(SR)
        w.writeframes(data.tobytes())
    print("wrote", name, f"{len(x)/SR:.1f}s")


def loopify(x, fade):
    """Make seamless: render extra tail and crossfade it onto the head."""
    n = int(fade * SR)
    body, tail = x[:-n], x[-n:]
    ramp = np.linspace(0, 1, n)
    body[:n] = body[:n] * ramp + tail * (1 - ramp)
    return body


def noise(d):
    return rng.standard_normal(int(SR * d))


def pink(d):
    n = int(SR * d)
    X = np.fft.rfft(rng.standard_normal(n))
    f = np.fft.rfftfreq(n, 1 / SR)
    f[0] = 1
    return np.fft.irfft(X / np.sqrt(f), n)


def midi(m):
    return 440 * 2 ** ((m - 69) / 12)


# ------------------------------------------------------------------ music: lofi dream pad + kalimba
def music():
    bars, bpm = 16, 68
    beat = 60 / bpm
    dur = bars * 4 * beat
    total = dur + 4.0
    x = np.zeros(int(total * SR))
    chords = [[53, 57, 60, 64], [57, 60, 64, 67], [50, 53, 57, 60, 64], [48, 52, 55, 59]]  # Fmaj7 Am7 Dm9 Cmaj7
    for b in range(bars):
        ch = chords[(b // 2) % 4]
        st = int(b * 4 * beat * SR)
        if b % 2:
            continue
        L = 8 * beat + 2.5
        tt = t(L)
        e = env(len(tt), 1.6, 2.6, 1.5)
        for m in ch:
            f = midi(m)
            v = 0
            for det in (-0.12, 0.0, 0.11):
                ff = f * 2 ** (det / 12)
                v = v + np.sin(2 * np.pi * ff * tt) + 0.18 * np.sin(2 * np.pi * 2 * ff * tt)
            v *= 0.5 + 0.5 * np.sin(2 * np.pi * 0.15 * tt + m)
            seg = v * e * 0.06
            x[st:st + len(seg)] += seg[: len(x) - st]
        # soft bass
        f = midi(ch[0] - 12)
        bb = np.sin(2 * np.pi * f * tt) * env(len(tt), 0.3, 2.0, 2) * 0.12
        x[st:st + len(bb)] += bb[: len(x) - st]
    # kalimba plucks, pentatonic, sparse
    scale = [65, 67, 69, 72, 74, 76, 79]
    for i in range(int(dur / (beat / 2))):
        if rng.random() < 0.28:
            m = scale[rng.integers(len(scale))]
            f = midi(m)
            tt = t(1.6)
            v = (np.sin(2 * np.pi * f * tt) + 0.25 * np.sin(2 * np.pi * f * 3.01 * tt) * np.exp(-tt * 9)) * np.exp(-tt * 3.2)
            v *= env(len(tt), 0.004, 0.3)
            st = int(i * beat / 2 * SR)
            x[st:st + len(v)] += v[: len(x) - st] * 0.09
    # vinyl-ish soft air
    x += lp_fast(pink(total), 1800) * 0.004
    x = lp_fast(x, 3800)
    # simple echo for space
    d = int(beat * 0.75 * SR)
    y = x.copy()
    y[d:] += x[:-d] * 0.28
    y[2 * d:] += x[:-2 * d] * 0.12
    save("music_pad", loopify(y, 4.0), -9.0, 4000)


def wind():
    d = 24 + 3
    x = lp_fast(pink(d), 700)
    sw = 0.55 + 0.45 * np.sin(2 * np.pi * t(d) / 9.0) * np.sin(2 * np.pi * t(d) / 5.3 + 1)
    x *= sw
    save("amb_wind", loopify(x, 3.0), -12.0, 900)


def water_amb():
    d = 12 + 2
    x = bandpass(noise(d), 300, 1600) * 0.3
    for _ in range(60):  # little bubbles
        st = rng.integers(0, int((d - 0.2) * SR))
        f0 = rng.uniform(500, 900)
        tt = t(0.08)
        b = np.sin(2 * np.pi * (f0 + 1800 * tt) * tt) * np.exp(-tt * 50)
        x[st:st + len(b)] += b * 0.5
    save("amb_water", loopify(x, 2.0), -14.0, 2500)


def bird(name, seed):
    r = np.random.default_rng(seed)
    out = np.zeros(int(SR * 1.4))
    pos = 0
    for k in range(r.integers(2, 5)):
        L = r.uniform(0.08, 0.18)
        tt = t(L)
        f0 = r.uniform(1500, 2300)
        sweep = r.uniform(-500, 500)
        f = f0 + sweep * tt / L + 120 * np.sin(2 * np.pi * 28 * tt)
        ph = 2 * np.pi * np.cumsum(f) / SR
        v = np.sin(ph) * np.sin(np.pi * tt / L) ** 2
        out[pos:pos + len(v)] += v
        pos += len(v) + int(r.uniform(0.04, 0.12) * SR)
    save(name, out, -14.0, 3200)


def crow(name, seed):
    r = np.random.default_rng(seed)
    out = np.zeros(int(SR * 1.4))
    pos = 0
    for k in range(r.integers(1, 3)):
        L = r.uniform(0.25, 0.35)
        tt = t(L)
        f = r.uniform(380, 460) * (1 - 0.25 * tt / L)
        ph = 2 * np.pi * np.cumsum(f) / SR
        saw = sum(np.sin(h * ph) / h for h in range(1, 12))
        v = saw + 0.4 * noise(L)
        v = bandpass(v, 600, 2200) + bandpass(v, 1100, 1600)
        v *= np.sin(np.pi * tt / L) ** 1.5
        out[pos:pos + len(v)] += v
        pos += len(v) + int(0.15 * SR)
    save(name, out, -13.0, 2600)


def croak(name, f0, pulses, rate):
    L = pulses / rate + 0.12
    tt = t(L)
    carrier = sum(np.sin(2 * np.pi * f0 * h * tt) / h ** 1.2 for h in range(1, 9))
    am = (0.5 + 0.5 * np.sin(2 * np.pi * rate * tt - np.pi / 2)) ** 3
    v = carrier * am
    v = bandpass(v, 150, 1400) + 0.6 * bandpass(v, 600, 1100)
    v *= env(len(tt), 0.02, 0.12)
    save(name, v, -8.0, 2200)


def simple():
    tt = t(0.22)
    save("hop", np.sin(2 * np.pi * (180 - 300 * tt) * tt) * np.exp(-tt * 20) + 0.15 * lp_fast(noise(0.22), 900) * np.exp(-tt * 30), -12, 1500)
    tt = t(0.25)
    save("land", np.sin(2 * np.pi * (120 - 120 * tt) * tt) * np.exp(-tt * 18) + 0.3 * lp_fast(noise(0.25), 700) * np.exp(-tt * 25), -11, 1200)
    tt = t(0.35)
    save("plop", np.sin(2 * np.pi * np.cumsum(900 * np.exp(-tt * 9) + 280) / SR) * np.exp(-tt * 9), -9, 3000)
    tt = t(1.2)
    sp = lp_fast(noise(1.2), 2200) * np.exp(-tt * 4) * env(len(tt), 0.01, 0.6)
    save("splash", sp + 0.5 * np.sin(2 * np.pi * np.cumsum(700 * np.exp(-tt * 6) + 200) / SR) * np.exp(-tt * 7), -8, 3000)
    tt = t(0.9)
    ch = (np.sin(2 * np.pi * 784 * tt) + 0.3 * np.sin(2 * np.pi * 1568 * tt)) * np.exp(-tt * 5)
    ch2 = np.zeros_like(tt)
    o = int(0.09 * SR)
    ch2[o:] = ((np.sin(2 * np.pi * 1175 * tt) + 0.3 * np.sin(2 * np.pi * 2350 * tt)) * np.exp(-tt * 5))[:-o]
    save("snack", (ch + ch2) * env(len(tt), 0.005, 0.3), -11, 4000)
    tt = t(0.25)
    save("tongue", bandpass(noise(0.25), 300, 1500) * np.sin(np.pi * tt / 0.25) ** 2 + 0.6 * np.sin(2 * np.pi * (500 - 900 * tt) * tt) * np.exp(-tt * 12), -13, 2000)
    # grow: rising soft bell arpeggio
    out = np.zeros(int(SR * 2.4))
    for i, m in enumerate([72, 76, 79, 84, 88]):
        tt = t(1.6)
        v = (np.sin(2 * np.pi * midi(m) * tt) + 0.2 * np.sin(2 * np.pi * midi(m) * 2.76 * tt) * np.exp(-tt * 6)) * np.exp(-tt * 3)
        st = int(i * 0.14 * SR)
        out[st:st + len(v)] += v * env(len(tt), 0.01, 0.4)
    out += lp_fast(pink(2.4), 1500) * 0.1 * np.sin(np.pi * t(2.4) / 2.4)
    save("grow", out, -11, 4000)
    tt = t(0.12)
    save("click", bandpass(noise(0.12), 400, 1800) * np.exp(-tt * 60) + 0.6 * np.sin(2 * np.pi * 320 * tt) * np.exp(-tt * 40), -12, 2200)
    tt = t(1.6)
    save("stone", lp_fast(pink(1.6), 260) * env(len(tt), 0.2, 0.5) * (0.8 + 0.2 * np.sin(2 * np.pi * 9 * tt)), -10, 600)
    tt = t(0.9)
    cr = np.sin(2 * np.pi * np.cumsum(140 + 30 * np.sin(2 * np.pi * 3 * tt)) / SR) * (0.5 + 0.5 * np.sign(np.sin(2 * np.pi * 22 * tt)))
    save("valve", bandpass(cr, 100, 900) * env(len(tt), 0.05, 0.3), -13, 1200)
    tt = t(3.0)
    save("water_rise", bandpass(noise(3.0), 200, 1400) * env(len(tt), 0.6, 1.0) * (0.7 + 0.3 * np.sin(2 * np.pi * 4 * tt)), -12, 1800)
    tt = t(0.3)
    save("seed", np.sin(2 * np.pi * np.cumsum(400 + 900 * tt) / SR) * np.exp(-tt * 12), -11, 3000)
    # puzzle solved: gentle 4-note rise
    out = np.zeros(int(SR * 2.2))
    for i, m in enumerate([67, 71, 74, 79]):
        tt = t(1.4)
        v = (np.sin(2 * np.pi * midi(m) * tt) + 0.25 * np.sin(2 * np.pi * midi(m) * 2 * tt)) * np.exp(-tt * 2.6)
        st = int(i * 0.16 * SR)
        out[st:st + len(v)] += v * env(len(tt), 0.006, 0.4)
    save("solve", out, -9, 4000)
    # level complete: warm chord swell + kalimba
    tt = t(4.0)
    out = np.zeros(len(tt))
    for m in [60, 64, 67, 71, 74]:
        out += np.sin(2 * np.pi * midi(m) * tt) * env(len(tt), 0.8, 2.2, 1.5)
    for i, m in enumerate([72, 76, 79, 83, 84]):
        k = t(1.5)
        v = np.sin(2 * np.pi * midi(m) * k) * np.exp(-k * 3)
        st = int((0.3 + i * 0.22) * SR)
        out[st:st + len(v)] += v * 0.9
    save("complete", out, -8, 4000)
    tt = t(0.08)
    save("ui_move", np.sin(2 * np.pi * 620 * tt) * np.exp(-tt * 60), -16, 2500)
    tt = t(0.18)
    save("ui_select", (np.sin(2 * np.pi * 520 * tt) + np.sin(2 * np.pi * 780 * tt)) * np.exp(-tt * 25), -14, 3000)
    tt = t(0.6)
    save("whoosh", lp_fast(noise(0.6), 900) * np.sin(np.pi * tt / 0.6) ** 2, -14, 1200)
    tt = t(0.5)
    fl = lp_fast(noise(0.5), 1000) * (0.5 + 0.5 * np.sin(2 * np.pi * 11 * tt)) ** 2 * env(len(tt), 0.02, 0.2)
    save("flap", fl, -14, 1400)
    tt = t(0.08)
    save("step", lp_fast(noise(0.08), 500) * np.exp(-tt * 70), -20, 800)


if __name__ == "__main__":
    music()
    wind()
    water_amb()
    for i in range(3):
        bird(f"bird{i+1}", 10 + i)
    for i in range(2):
        crow(f"crow{i+1}", 20 + i)
    croak("croak1", 150, 3, 14)
    croak("croak2", 210, 2, 18)
    croak("croak3", 120, 4, 11)
    simple()
