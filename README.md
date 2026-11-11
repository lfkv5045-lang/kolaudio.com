# Kolaudio

Kolaudio is a static, browser-based audio editor. Open `index.html` or publish the repository root with GitHub Pages.

## Features
- Import audio with the file picker or drag-and-drop (multiple files are accepted and loaded one at a time).
- Record from a microphone on HTTPS or localhost.
- Select a waveform range, cut/copy/paste/delete/trim/silence/duplicate, undo and redo.
- Apply basic normalization, fades, gain, reverse, phase inversion and echo; local voice-effect presets are simple DSP and are not AI voice cloning.
- Export edited audio as WAV or MP3 at 128, 192, 256, or 320 kbps. MP3 export requires the LAME encoder CDN to load.
- Switch the interface between English and Yiddish. The Yiddish labels are a hand-curated initial translation, not a claim of endorsement or certification by a professional translation service.
- Review/download a local activity log and submit feedback saved only in the current browser's local storage. Neither feature sends data to a server.

Audio decoding is subject to browser codec support. No audio or feedback is uploaded by this static app.
