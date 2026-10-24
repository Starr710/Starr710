# Guard voice recordings (not yet supplied)

The guard's first-sound reaction asks for the line `huh` (`js/movement/guard-voice.js`).
Until recordings exist here, it is logged (STATS → VOICE: "no recording yet") and stays silent.
No synthesized voice stands in for it.

Wanted: `huh-1.m4a`, `huh-2.m4a` (two takes, so repeats across incidents vary).
- A real, natural, under-the-breath questioning "huh?" / "hm?" from an adult male. Not acted or comic.
- Mono, 0.3–0.6 s, trimmed tight, no room reverb, peak around −6 dBFS.
- m4a (AAC) is the safest format for iPhone Safari; mp3 or wav also work (change the paths in `GuardVoiceDefaults.lines`).
- Use only recordings you own or that are properly licensed. Add the licence next to the files.

Volume: `GuardVoiceDefaults.volume` (0.7), softened with distance by `falloff`.
