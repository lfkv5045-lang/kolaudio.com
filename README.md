# Kolaudio

A small browser-based audio studio inspired by classic desktop audio editors. It runs as a static website with no build step.

## Run locally

Open `index.html` in a modern browser, or serve this directory with any static web server. Microphone recording requires a secure context (HTTPS or localhost) and permission to use the microphone.

## Features

- Import common audio files and preview a waveform
- Play, pause, stop, seek, and adjust playback volume
- Zoom the waveform and fit the whole project
- Record from a microphone using the browser's MediaRecorder API
- Download the imported or recorded audio

Audio decoding support depends on the codecs available in the browser. Export currently downloads the original imported audio (or the browser recording); it does not apply destructive editing or convert formats.
