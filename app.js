const fileInput = document.getElementById('fileInput');
const audio = document.getElementById('audio');
const waveform = document.getElementById('waveform');
const waveCtx = waveform.getContext('2d');
const timeline = document.getElementById('timeline');
const timeCtx = timeline.getContext('2d');
const playhead = document.getElementById('playhead');
const toast = document.getElementById('toast');
const waveScroll = document.getElementById('waveScroll');
let audioBuffer = null;
let zoom = 1;
let mediaRecorder = null;
let recordedChunks = [];
let currentFileName = '';
let selection = null;
let history = [];
let historyIndex = -1;
let clipboard = null;
let isSelecting = false;
let previewUrl = null;

const editStyle = document.createElement('style');
editStyle.textContent = `
.editor-actions{display:flex;align-items:center;gap:5px;flex-wrap:wrap}.editor-actions button,.editor-actions select{height:27px;border:1px solid #393a42;border-radius:4px;background:#23242a;color:#c5c6cc;padding:0 8px;font:10px 'DM Sans',sans-serif;cursor:pointer}.editor-actions button:hover,.editor-actions select:hover{border-color:#d2f36b;color:#d2f36b}.editor-actions button:disabled{opacity:.38;cursor:not-allowed}.editor-actions .danger-tool{color:#ff9295}.editbar{height:auto;min-height:47px;gap:8px;flex-wrap:wrap;padding-top:7px;padding-bottom:7px}.selection-overlay{position:absolute;top:0;bottom:0;background:#d2f36b25;border-left:1px solid #d2f36b;border-right:1px solid #d2f36b;z-index:1;pointer-events:none;display:none}.wave-scroll{touch-action:none}.track-controls input{cursor:pointer}@media(max-width:900px){.editor-actions{order:3;width:100%;padding:5px 0;overflow-x:auto;flex-wrap:nowrap}.editbar{justify-content:flex-start}.track-info{margin-left:auto}}
`;
document.head.append(editStyle);
const editorActions = document.createElement('div');
editorActions.className = 'editor-actions';
editorActions.innerHTML = `
  <button data-action="undo" title="Undo (Ctrl+Z)">↶ Undo</button><button data-action="redo" title="Redo (Ctrl+Shift+Z)">↷ Redo</button>
  <button data-action="cut" title="Cut selection">Cut</button><button data-action="copy" title="Copy selection">Copy</button><button data-action="paste" title="Paste at playhead">Paste</button>
  <button data-action="delete" class="danger-tool" title="Delete selection">Delete</button><button data-action="trim" title="Keep selection and remove the rest">Trim</button>
  <button data-action="silence" title="Silence selection">Silence</button><button data-action="duplicate" title="Duplicate selection">Duplicate</button>
  <select id="effectSelect" aria-label="Audio effect"><option value="">Effects…</option><option value="normalize">Normalize</option><option value="fadeIn">Fade in selection</option><option value="fadeOut">Fade out selection</option><option value="amplify">Amplify +3 dB</option><option value="reduce">Reduce −3 dB</option><option value="reverse">Reverse selection</option><option value="invert">Invert selection</option></select>
  <button data-action="exportWav" title="Export edited audio as WAV">Export WAV</button>`;
document.querySelector('.editbar').append(editorActions);
const selectionOverlay = document.createElement('div');
selectionOverlay.className = 'selection-overlay';
waveScroll.append(selectionOverlay);

function notify(message) {
  toast.textContent = message;
  toast.classList.add('show');
  clearTimeout(notify.timer);
  notify.timer = setTimeout(() => toast.classList.remove('show'), 2800);
}
function formatTime(seconds) {
  if (!Number.isFinite(seconds)) seconds = 0;
  const minutes = Math.floor(seconds / 60);
  const remainder = seconds % 60;
  return `${String(minutes).padStart(2, '0')}:${remainder.toFixed(1).padStart(4, '0')}`;
}
function chooseFile() { fileInput.click(); }
document.getElementById('openFile').addEventListener('click', chooseFile);
document.getElementById('addAudio').addEventListener('click', chooseFile);
fileInput.addEventListener('change', () => {
  if (fileInput.files[0]) loadAudio(fileInput.files[0]);
  fileInput.value = '';
});

function cloneBuffer(source) {
  const copy = new AudioBuffer({length: source.length, numberOfChannels: source.numberOfChannels, sampleRate: source.sampleRate});
  for (let channel = 0; channel < source.numberOfChannels; channel++) copy.copyToChannel(source.getChannelData(channel).slice(), channel);
  return copy;
}
function saveHistory() {
  if (!audioBuffer) return;
  history = history.slice(0, historyIndex + 1);
  history.push(cloneBuffer(audioBuffer));
  if (history.length > 30) history.shift();
  historyIndex = history.length - 1;
  updateEditButtons();
}
function updateEditButtons() {
  const hasAudio = !!audioBuffer;
  const hasSelection = !!selection && selection.end - selection.start > 1;
  for (const button of editorActions.querySelectorAll('button[data-action]')) {
    const action = button.dataset.action;
    button.disabled = !hasAudio || (['cut','copy','delete','trim','silence','duplicate'].includes(action) && !hasSelection) || (action === 'paste' && !clipboard) || (action === 'undo' && historyIndex <= 0) || (action === 'redo' && historyIndex >= history.length - 1);
  }
  document.getElementById('selectionInfo').textContent = hasSelection ? `${formatTime(selection.start / audioBuffer.sampleRate)} – ${formatTime(selection.end / audioBuffer.sampleRate)} (${formatTime((selection.end - selection.start) / audioBuffer.sampleRate)})` : 'No selection';
}
function selectedRange() {
  if (!audioBuffer) return null;
  if (selection && selection.end - selection.start > 1) return [Math.max(0, selection.start), Math.min(audioBuffer.length, selection.end)];
  return [0, audioBuffer.length];
}
function selectionRangeRequired() {
  if (!audioBuffer) { notify('Import or record audio first.'); return null; }
  if (!selection || selection.end - selection.start < 2) { notify('Drag across the waveform to select audio first.'); return null; }
  return [Math.max(0, selection.start), Math.min(audioBuffer.length, selection.end)];
}
function setSelection(start, end) {
  if (!audioBuffer) return;
  const low = Math.max(0, Math.min(start, end));
  const high = Math.min(audioBuffer.length, Math.max(start, end));
  selection = high - low > 1 ? {start: low, end: high} : null;
  updateSelectionDisplay();
  updateEditButtons();
}
function updateSelectionDisplay() {
  if (!selection || !audioBuffer) { selectionOverlay.style.display = 'none'; return; }
  const duration = audioBuffer.duration / zoom;
  const startSeconds = selection.start / audioBuffer.sampleRate;
  const endSeconds = selection.end / audioBuffer.sampleRate;
  const left = startSeconds / duration * 100;
  const right = endSeconds / duration * 100;
  selectionOverlay.style.left = `${Math.max(0, left)}%`;
  selectionOverlay.style.width = `${Math.max(0, Math.min(100, right) - Math.max(0, left))}%`;
  selectionOverlay.style.display = right <= 0 || left >= 100 ? 'none' : 'block';
}
function updateTrackMetadata() {
  if (!audioBuffer) return;
  document.getElementById('trackMeta').textContent = `${audioBuffer.numberOfChannels === 1 ? 'MONO' : 'STEREO'} · ${(audioBuffer.sampleRate / 1000).toFixed(1)} KHZ`;
  document.querySelector('.bottom-bar').lastElementChild.innerHTML = `${(audioBuffer.sampleRate / 1000).toFixed(1)} kHz <span class="bottom-divider">·</span> ${audioBuffer.numberOfChannels === 1 ? 'Mono' : 'Stereo'}`;
  document.getElementById('duration').textContent = formatTime(audioBuffer.duration);
}
function bufferToWav(buffer) {
  const channels = buffer.numberOfChannels;
  const frames = buffer.length;
  const bytesPerSample = 2;
  const dataSize = frames * channels * bytesPerSample;
  const output = new ArrayBuffer(44 + dataSize);
  const view = new DataView(output);
  const writeString = (offset, text) => { for (let i = 0; i < text.length; i++) view.setUint8(offset + i, text.charCodeAt(i)); };
  writeString(0, 'RIFF'); view.setUint32(4, 36 + dataSize, true); writeString(8, 'WAVE');
  writeString(12, 'fmt '); view.setUint32(16, 16, true); view.setUint16(20, 1, true); view.setUint16(22, channels, true);
  view.setUint32(24, buffer.sampleRate, true); view.setUint32(28, buffer.sampleRate * channels * bytesPerSample, true);
  view.setUint16(32, channels * bytesPerSample, true); view.setUint16(34, 16, true); writeString(36, 'data'); view.setUint32(40, dataSize, true);
  let offset = 44;
  for (let frame = 0; frame < frames; frame++) for (let channel = 0; channel < channels; channel++) {
    const sample = Math.max(-1, Math.min(1, buffer.getChannelData(channel)[frame]));
    view.setInt16(offset, sample < 0 ? sample * 32768 : sample * 32767, true); offset += 2;
  }
  return new Blob([output], {type: 'audio/wav'});
}
function refreshPreview() {
  if (!audioBuffer) return;
  const blob = bufferToWav(audioBuffer);
  if (previewUrl) URL.revokeObjectURL(previewUrl);
  previewUrl = URL.createObjectURL(blob);
  audio.src = previewUrl;
  audio.load();
  document.getElementById('exportBtn').disabled = false;
  drawWaveform(); drawTimeline(); updateTrackMetadata(); updateSelectionDisplay(); updateEditButtons();
}
async function loadAudio(file) {
  if (!file.type.startsWith('audio/') && !/\.(wav|mp3|ogg|m4a|flac|webm|aac)$/i.test(file.name)) { notify('That file does not look like audio. Try an MP3 or WAV.'); return; }
  currentFileName = file.name;
  document.getElementById('projectTitle').textContent = file.name.replace(/\.[^.]+$/, '');
  document.getElementById('trackName').textContent = file.name;
  document.getElementById('trackInfo').textContent = file.name;
  try {
    const AudioContextClass = window.AudioContext || window.webkitAudioContext;
    if (!AudioContextClass) throw new Error('Audio decoding is not supported in this browser.');
    const decodeContext = new AudioContextClass();
    audioBuffer = await decodeContext.decodeAudioData(await file.arrayBuffer());
    await decodeContext.close();
    history = []; historyIndex = -1; selection = null; clipboard = null;
    saveHistory();
    refreshPreview();
    document.getElementById('emptyTrack').hidden = true;
    document.getElementById('studio').hidden = false;
    document.getElementById('welcome').hidden = true;
    notify('Audio loaded. Drag across the waveform to select a section.');
  } catch (error) {
    audioBuffer = null;
    audio.src = URL.createObjectURL(file);
    document.getElementById('studio').hidden = false;
    document.getElementById('welcome').hidden = true;
    document.getElementById('emptyTrack').hidden = false;
    document.getElementById('exportBtn').disabled = true;
    updateEditButtons();
    notify(error.message || 'This audio format is not supported by the browser.');
  }
}
function resizeCanvas(canvas, context) {
  const rect = canvas.getBoundingClientRect();
  const dpr = window.devicePixelRatio || 1;
  canvas.width = Math.max(1, Math.floor(rect.width * dpr));
  canvas.height = Math.max(1, Math.floor(rect.height * dpr));
  context.setTransform(dpr, 0, 0, dpr, 0, 0);
  return {w: rect.width, h: rect.height};
}
function drawWaveform() {
  if (!audioBuffer) return;
  const {w, h} = resizeCanvas(waveform, waveCtx);
  waveCtx.clearRect(0, 0, w, h);
  const data = audioBuffer.getChannelData(0);
  const visibleLength = Math.max(1, Math.floor(data.length / zoom));
  const step = Math.max(1, Math.ceil(visibleLength / w));
  const center = h / 2;
  const gradient = waveCtx.createLinearGradient(0, 0, 0, h);
  gradient.addColorStop(0, '#d7f77e'); gradient.addColorStop(.5, '#b5df59'); gradient.addColorStop(1, '#83ba43');
  waveCtx.fillStyle = gradient;
  for (let x = 0; x < w; x++) {
    const start = x * step, end = Math.min(start + step, visibleLength);
    let min = 1, max = -1;
    for (let i = start; i < end; i++) { const value = data[i]; if (value < min) min = value; if (value > max) max = value; }
    if (max >= min) waveCtx.fillRect(x, center - Math.max(1, (max - min) * h * .39) / 2, 1, Math.max(1, (max - min) * h * .39));
  }
  if (audioBuffer.numberOfChannels > 1) {
    const right = audioBuffer.getChannelData(1); waveCtx.globalAlpha = .45;
    for (let x = 0; x < w; x++) {
      const start = x * step, end = Math.min(start + step, visibleLength); let min = 1, max = -1;
      for (let i = start; i < end; i++) { const value = right[i]; if (value < min) min = value; if (value > max) max = value; }
      if (max >= min) waveCtx.fillRect(x, center + h * .27 - Math.max(1, (max - min) * h * .18) / 2, 1, Math.max(1, (max - min) * h * .18));
    }
    waveCtx.globalAlpha = 1;
  }
}
function drawTimeline() {
  const {w, h} = resizeCanvas(timeline, timeCtx);
  timeCtx.clearRect(0, 0, w, h); timeCtx.font = '9px "DM Mono", monospace'; timeCtx.textBaseline = 'middle';
  const duration = audioBuffer ? audioBuffer.duration / zoom : 60;
  const interval = duration > 120 ? 30 : duration > 45 ? 10 : duration > 20 ? 5 : duration > 8 ? 2 : 1;
  for (let second = 0; second <= duration; second += interval) {
    const x = second / duration * w;
    timeCtx.fillStyle = '#393a42'; timeCtx.fillRect(x, 22, 1, 6);
    timeCtx.fillStyle = '#858791'; timeCtx.fillText(formatTime(second).slice(0, 5), x + 4, 12);
  }
}
function updatePlayhead() {
  const duration = audioBuffer ? audioBuffer.duration / zoom : audio.duration || 1;
  playhead.style.left = `${Math.min(100, audio.currentTime / duration * 100)}%`;
  document.getElementById('currentTime').textContent = formatTime(audio.currentTime);
}
function seekFromPointer(event) {
  if (!audioBuffer) return;
  const rect = waveform.getBoundingClientRect();
  const percent = Math.max(0, Math.min(1, (event.clientX - rect.left) / rect.width));
  audio.currentTime = percent * audioBuffer.duration / zoom;
  updatePlayhead();
}
waveScroll.addEventListener('pointerdown', event => {
  if (!audioBuffer || event.target !== waveform) return;
  isSelecting = true;
  waveScroll.setPointerCapture(event.pointerId);
  const rect = waveform.getBoundingClientRect();
  const time = Math.max(0, Math.min(1, (event.clientX - rect.left) / rect.width)) * audioBuffer.duration / zoom;
  const sample = Math.floor(time * audioBuffer.sampleRate);
  selection = {start: sample, end: sample};
  waveScroll.dataset.selectionStart = String(sample);
  updateSelectionDisplay();
});
waveScroll.addEventListener('pointermove', event => {
  if (!isSelecting || !audioBuffer) return;
  const rect = waveform.getBoundingClientRect();
  const time = Math.max(0, Math.min(1, (event.clientX - rect.left) / rect.width)) * audioBuffer.duration / zoom;
  setSelection(Number(waveScroll.dataset.selectionStart), Math.floor(time * audioBuffer.sampleRate));
});
waveScroll.addEventListener('pointerup', event => {
  if (!isSelecting) return;
  isSelecting = false;
  if (selection && selection.end - selection.start < 2) { selection = null; seekFromPointer(event); updateSelectionDisplay(); updateEditButtons(); }
});
audio.addEventListener('timeupdate', updatePlayhead);
audio.addEventListener('ended', () => { document.getElementById('playBtn').innerHTML = '<svg viewBox="0 0 24 24"><path d="M8 5v14l11-7z"/></svg>'; updatePlayhead(); });
document.getElementById('playBtn').addEventListener('click', async () => {
  if (!audio.src) { notify('Import an audio file first.'); return; }
  if (audio.paused) { try { await audio.play(); document.getElementById('playBtn').innerHTML = '<svg viewBox="0 0 24 24"><path d="M6 5h4v14H6zm8 0h4v14h-4z"/></svg>'; } catch { notify('This audio could not be played in your browser.'); } }
  else { audio.pause(); document.getElementById('playBtn').innerHTML = '<svg viewBox="0 0 24 24"><path d="M8 5v14l11-7z"/></svg>'; }
});
document.getElementById('stopBtn').addEventListener('click', () => { audio.pause(); audio.currentTime = 0; updatePlayhead(); document.getElementById('playBtn').innerHTML = '<svg viewBox="0 0 24 24"><path d="M8 5v14l11-7z"/></svg>'; });
document.getElementById('volume').addEventListener('input', event => audio.volume = Number(event.target.value));
document.getElementById('zoomIn').addEventListener('click', () => { zoom = Math.min(16, zoom * 1.35); drawWaveform(); drawTimeline(); updateSelectionDisplay(); updatePlayhead(); });
document.getElementById('zoomOut').addEventListener('click', () => { zoom = Math.max(1, zoom / 1.35); drawWaveform(); drawTimeline(); updateSelectionDisplay(); updatePlayhead(); });
document.getElementById('fitBtn').addEventListener('click', () => { zoom = 1; drawWaveform(); drawTimeline(); updateSelectionDisplay(); updatePlayhead(); });
document.getElementById('exportBtn').addEventListener('click', () => { if (audioBuffer) downloadBlob(bufferToWav(audioBuffer), `${currentFileName.replace(/\.[^.]+$/, '') || 'kolaudio-edit'}.wav`); else if (audio.src) { const link = document.createElement('a'); link.href = audio.src; link.download = currentFileName || 'kolaudio-recording'; link.click(); } });
function downloadBlob(blob, name) { const link = document.createElement('a'); const url = URL.createObjectURL(blob); link.href = url; link.download = name; link.click(); setTimeout(() => URL.revokeObjectURL(url), 1000); }

function makeBuffer(channels, length, sampleRate) {
  return new AudioBuffer({numberOfChannels: channels, length: Math.max(1, length), sampleRate});
}
function extractBuffer(source, start, end) {
  const output = makeBuffer(source.numberOfChannels, Math.max(1, end - start), source.sampleRate);
  for (let ch = 0; ch < source.numberOfChannels; ch++) output.copyToChannel(source.getChannelData(ch).slice(start, end), ch);
  return output;
}
function joinBuffers(first, second, insertAt = first.length) {
  const channels = Math.max(first.numberOfChannels, second.numberOfChannels);
  const output = makeBuffer(channels, first.length + second.length, first.sampleRate);
  for (let ch = 0; ch < channels; ch++) {
    const a = first.getChannelData(Math.min(ch, first.numberOfChannels - 1));
    const b = second.getChannelData(Math.min(ch, second.numberOfChannels - 1));
    const target = output.getChannelData(ch);
    target.set(a.subarray(0, insertAt), 0);
    target.set(b, insertAt);
    target.set(a.subarray(insertAt), insertAt + second.length);
  }
  return output;
}
function replaceBuffer(next, message) {
  audio.pause(); audioBuffer = next; saveHistory(); refreshPreview();
  document.getElementById('playBtn').innerHTML = '<svg viewBox="0 0 24 24"><path d="M8 5v14l11-7z"/></svg>';
  notify(message);
}
function deleteSelection() {
  const range = selectionRangeRequired(); if (!range) return;
  const [start, end] = range;
  const next = joinBuffers(extractBuffer(audioBuffer, 0, start), extractBuffer(audioBuffer, end, audioBuffer.length));
  selection = null; replaceBuffer(next, 'Selection deleted.');
}
function undo() {
  if (historyIndex <= 0) return;
  historyIndex--; audioBuffer = cloneBuffer(history[historyIndex]); selection = null; refreshPreview(); notify('Undo complete.');
}
function redo() {
  if (historyIndex >= history.length - 1) return;
  historyIndex++; audioBuffer = cloneBuffer(history[historyIndex]); selection = null; refreshPreview(); notify('Redo complete.');
}
function applyEffect(effect) {
  if (!audioBuffer) { notify('Import or record audio first.'); return; }
  const range = selectionRangeRequired(); if (!range) return;
  const [start, end] = range;
  const next = cloneBuffer(audioBuffer);
  for (let ch = 0; ch < next.numberOfChannels; ch++) {
    const data = next.getChannelData(ch);
    if (effect === 'normalize') {
      let peak = 0; for (let i = start; i < end; i++) peak = Math.max(peak, Math.abs(data[i]));
      if (peak > 0) { const gain = .98 / peak; for (let i = start; i < end; i++) data[i] *= gain; }
    } else if (effect === 'fadeIn' || effect === 'fadeOut') {
      const length = end - start;
      for (let i = start; i < end; i++) { const amount = length <= 1 ? 1 : (i - start) / (length - 1); data[i] *= effect === 'fadeIn' ? amount : 1 - amount; }
    } else if (effect === 'amplify' || effect === 'reduce') {
      const gain = effect === 'amplify' ? Math.pow(10, 3 / 20) : Math.pow(10, -3 / 20);
      for (let i = start; i < end; i++) data[i] = Math.max(-1, Math.min(1, data[i] * gain));
    } else if (effect === 'reverse') {
      const segment = data.slice(start, end).reverse(); data.set(segment, start);
    } else if (effect === 'invert') {
      for (let i = start; i < end; i++) data[i] = -data[i];
    } else if (effect === 'silence') data.fill(0, start, end);
  }
  replaceBuffer(next, `${effect === 'fadeIn' ? 'Fade in' : effect === 'fadeOut' ? 'Fade out' : effect[0].toUpperCase() + effect.slice(1)} applied.`);
}
editorActions.addEventListener('click', event => {
  const button = event.target.closest('button[data-action]'); if (!button || button.disabled) return;
  const action = button.dataset.action;
  if (action === 'undo') undo();
  else if (action === 'redo') redo();
  else if (action === 'copy' || action === 'cut') {
    const range = selectionRangeRequired(); if (!range) return;
    clipboard = extractBuffer(audioBuffer, range[0], range[1]);
    if (action === 'cut') deleteSelection(); else { updateEditButtons(); notify('Selection copied.'); }
  } else if (action === 'delete') deleteSelection();
  else if (action === 'trim') {
    const range = selectionRangeRequired(); if (!range) return;
    const next = extractBuffer(audioBuffer, range[0], range[1]); selection = null; replaceBuffer(next, 'Trimmed to selection.');
  } else if (action === 'silence') applyEffect('silence');
  else if (action === 'duplicate') {
    const range = selectionRangeRequired(); if (!range) return;
    const part = extractBuffer(audioBuffer, range[0], range[1]);
    const next = joinBuffers(audioBuffer, part, range[1]); selection = {start: range[1], end: range[1] + part.length}; replaceBuffer(next, 'Selection duplicated.');
  } else if (action === 'paste') {
    if (!clipboard) return;
    const at = Math.max(0, Math.min(audioBuffer.length, Math.floor(audio.currentTime * audioBuffer.sampleRate)));
    const next = joinBuffers(audioBuffer, clipboard, at); selection = {start: at, end: at + clipboard.length}; replaceBuffer(next, 'Audio pasted at the playhead.');
  } else if (action === 'exportWav') {
    if (audioBuffer) downloadBlob(bufferToWav(audioBuffer), `${currentFileName.replace(/\.[^.]+$/, '') || 'kolaudio-edit'}.wav`);
  }
});
document.getElementById('effectSelect').addEventListener('change', event => {
  if (event.target.value) applyEffect(event.target.value);
  event.target.value = '';
});

window.addEventListener('keydown', event => {
  const target = event.target;
  if (target && (target.isContentEditable || ['INPUT','TEXTAREA','SELECT'].includes(target.tagName))) return;
  if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'z') { event.preventDefault(); event.shiftKey ? redo() : undo(); }
  else if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'y') { event.preventDefault(); redo(); }
  else if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'c' && selection) { event.preventDefault(); const range = selectionRangeRequired(); if (range) clipboard = extractBuffer(audioBuffer, range[0], range[1]); updateEditButtons(); notify('Selection copied.'); }
  else if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'x' && selection) { event.preventDefault(); const range = selectionRangeRequired(); if (range) { clipboard = extractBuffer(audioBuffer, range[0], range[1]); deleteSelection(); } }
  else if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'v' && clipboard && audioBuffer) { event.preventDefault(); const at = Math.floor(audio.currentTime * audioBuffer.sampleRate); const next = joinBuffers(audioBuffer, clipboard, at); selection = {start: at, end: at + clipboard.length}; replaceBuffer(next, 'Audio pasted.'); }
  else if (event.code === 'Space') { event.preventDefault(); document.getElementById('playBtn').click(); }
  else if (event.key === 'Delete' && selection) deleteSelection();
});

document.getElementById('muteBtn').addEventListener('click', event => { audio.muted = !audio.muted; event.currentTarget.classList.toggle('selected', audio.muted); notify(audio.muted ? 'Track muted.' : 'Track unmuted.'); });
document.getElementById('soloBtn').addEventListener('click', event => { event.currentTarget.classList.toggle('selected'); notify('Solo track toggled.'); });
document.querySelector('.track-controls input').addEventListener('input', event => { const pan = Number(event.target.value); audio.pan = pan; });
async function startRecording() {
  try {
    const stream = await navigator.mediaDevices.getUserMedia({audio: true});
    recordedChunks = [];
    mediaRecorder = new MediaRecorder(stream);
    mediaRecorder.ondataavailable = event => { if (event.data.size) recordedChunks.push(event.data); };
    mediaRecorder.onstop = () => {
      const blob = new Blob(recordedChunks, {type: mediaRecorder.mimeType || 'audio/webm'});
      const ext = blob.type.includes('mp4') ? 'm4a' : 'webm';
      stream.getTracks().forEach(track => track.stop());
      document.getElementById('recordBtn').classList.remove('recording');
      loadAudio(new File([blob], `kolaudio-recording.${ext}`, {type: blob.type}));
    };
    mediaRecorder.start(); document.getElementById('studio').hidden = false; document.getElementById('welcome').hidden = true;
    document.getElementById('recordBtn').classList.add('recording'); notify('Recording… press the red button again to finish.');
  } catch { notify('Microphone access was not available. Check browser permissions.'); }
}
function toggleRecord() { if (mediaRecorder?.state === 'recording') mediaRecorder.stop(); else startRecording(); }
document.getElementById('recordBtn').addEventListener('click', toggleRecord);
document.getElementById('recordIntro').addEventListener('click', () => { document.getElementById('studio').hidden = false; document.getElementById('welcome').hidden = true; toggleRecord(); });
document.getElementById('helpBtn').addEventListener('click', () => notify('Drag on the waveform to select. Use Cut/Copy/Paste/Delete/Trim, Silence, Duplicate, effects and Undo/Redo. Export WAV saves your edits.'));
window.addEventListener('resize', () => { if (audioBuffer) { drawWaveform(); drawTimeline(); updateSelectionDisplay(); } });
updateEditButtons();
