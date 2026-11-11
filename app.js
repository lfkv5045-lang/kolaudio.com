const fileInput=document.getElementById('fileInput');
const audio=document.getElementById('audio');
const waveform=document.getElementById('waveform');
const ctx=waveform.getContext('2d');
const timeline=document.getElementById('timeline');
const tctx=timeline.getContext('2d');
const playhead=document.getElementById('playhead');
const toast=document.getElementById('toast');
let audioBuffer=null,zoom=1,mediaRecorder=null,recordedChunks=[],currentFileName='';

function notify(message){toast.textContent=message;toast.classList.add('show');clearTimeout(notify.timer);notify.timer=setTimeout(()=>toast.classList.remove('show'),2800)}
function formatTime(seconds){if(!Number.isFinite(seconds))seconds=0;const m=Math.floor(seconds/60),s=seconds%60;return `${String(m).padStart(2,'0')}:${s.toFixed(1).padStart(4,'0')}`}
function chooseFile(){fileInput.click()}
document.getElementById('openFile').addEventListener('click',chooseFile);
document.getElementById('addAudio').addEventListener('click',chooseFile);
fileInput.addEventListener('change',()=>{if(fileInput.files[0])loadAudio(fileInput.files[0]);fileInput.value=''});

async function loadAudio(file){
  if(!file.type.startsWith('audio/')&&!/\.(wav|mp3|ogg|m4a|flac|webm|aac)$/i.test(file.name)){notify('That file does not look like audio. Try an MP3 or WAV.');return}
  currentFileName=file.name;document.getElementById('projectTitle').textContent=file.name.replace(/\.[^.]+$/,'');document.getElementById('trackName').textContent=file.name;document.getElementById('trackInfo').textContent=file.name;
  if(audio.src&&audio.src.startsWith('blob:'))URL.revokeObjectURL(audio.src);
  audio.src=URL.createObjectURL(file);audio.load();
  try{
    const AudioContextClass=window.AudioContext||window.webkitAudioContext;
    if(!AudioContextClass)throw new Error('Audio decoding is not supported in this browser.');
    const decodeContext=new AudioContextClass();
    audioBuffer=await decodeContext.decodeAudioData(await file.arrayBuffer());
    await decodeContext.close();
    document.getElementById('trackMeta').textContent=`${audioBuffer.numberOfChannels===1?'MONO':'STEREO'} · ${(audioBuffer.sampleRate/1000).toFixed(1)} KHZ`;
    document.querySelector('.bottom-bar').lastElementChild.innerHTML=`${(audioBuffer.sampleRate/1000).toFixed(1)} kHz <span class="bottom-divider">·</span> ${audioBuffer.numberOfChannels===1?'Mono':'Stereo'}`;
    drawWaveform();drawTimeline();document.getElementById('emptyTrack').hidden=true;
    document.getElementById('exportBtn').disabled=false;document.getElementById('exportMp3').disabled=false;
    document.getElementById('studio').hidden=false;document.getElementById('welcome').hidden=true;
    document.getElementById('duration').textContent=formatTime(audioBuffer.duration);
    notify('Audio loaded. Export your audio as MP3 or WAV.');
  }catch(error){
    audioBuffer=null;document.getElementById('studio').hidden=false;document.getElementById('welcome').hidden=true;
    document.getElementById('emptyTrack').hidden=false;document.getElementById('exportBtn').disabled=true;document.getElementById('exportMp3').disabled=true;
    notify(error.message||'This audio format is not supported by your browser.');
  }
}
function resizeCanvas(canvas,context){const rect=canvas.getBoundingClientRect(),dpr=window.devicePixelRatio||1;canvas.width=Math.max(1,Math.floor(rect.width*dpr));canvas.height=Math.max(1,Math.floor(rect.height*dpr));context.setTransform(dpr,0,0,dpr,0,0);return {w:rect.width,h:rect.height}}
function drawWaveform(){if(!audioBuffer)return;const {w,h}=resizeCanvas(waveform,ctx);ctx.clearRect(0,0,w,h);const data=audioBuffer.getChannelData(0),step=Math.max(1,Math.floor(data.length/(w*zoom))),center=h/2;const gradient=ctx.createLinearGradient(0,0,0,h);gradient.addColorStop(0,'#d7f77e');gradient.addColorStop(.5,'#b5df59');gradient.addColorStop(1,'#83ba43');ctx.fillStyle=gradient;for(let x=0;x<w;x++){const start=Math.floor(x*step),end=Math.min(start+step,data.length);let min=1,max=-1;for(let i=start;i<end;i++){const v=data[i];if(v<min)min=v;if(v>max)max=v}const amp=Math.max(1,(max-min)*h*.39);ctx.fillRect(x,center-amp/2,1,amp)}if(audioBuffer.numberOfChannels>1){const dataR=audioBuffer.getChannelData(1);ctx.globalAlpha=.48;for(let x=0;x<w;x++){const start=Math.floor(x*step),end=Math.min(start+step,dataR.length);let min=1,max=-1;for(let i=start;i<end;i++){const v=dataR[i];if(v<min)min=v;if(v>max)max=v}const amp=Math.max(1,(max-min)*h*.18);ctx.fillRect(x,center+h*.27-amp/2,1,amp)}ctx.globalAlpha=1}}
function drawTimeline(){const {w}=resizeCanvas(timeline,tctx);tctx.clearRect(0,0,w,36);tctx.fillStyle='#858791';tctx.font='9px "DM Mono", monospace';tctx.textBaseline='middle';const duration=(audioBuffer?.duration||60)/zoom,interval=duration>120?30:duration>45?10:duration>20?5:duration>8?2:1;for(let sec=0;sec<=duration;sec+=interval){const x=sec/duration*w;tctx.fillStyle='#393a42';tctx.fillRect(x,22,1,6);tctx.fillStyle='#858791';tctx.fillText(formatTime(sec).slice(0,5),x+4,12)}}
function updatePlayhead(){const d=audioBuffer?.duration||audio.duration||1;playhead.style.left=`${Math.min(100,(audio.currentTime/d)*100)}%`;document.getElementById('currentTime').textContent=formatTime(audio.currentTime)}
waveform.addEventListener('click',e=>{if(!audio.duration)return;const rect=waveform.getBoundingClientRect(),percent=Math.max(0,Math.min(1,(e.clientX-rect.left)/rect.width));audio.currentTime=percent*audio.duration;updatePlayhead()});
audio.addEventListener('timeupdate',updatePlayhead);audio.addEventListener('ended',()=>{document.getElementById('playBtn').innerHTML='<svg viewBox="0 0 24 24"><path d="M8 5v14l11-7z"/></svg>';updatePlayhead()});
document.getElementById('playBtn').addEventListener('click',async()=>{if(!audio.src){notify('Import an audio file first.');return}if(audio.paused){try{await audio.play();document.getElementById('playBtn').innerHTML='<svg viewBox="0 0 24 24"><path d="M6 5h4v14H6zm8 0h4v14h-4z"/></svg>'}catch{notify('This audio could not be played in your browser.')}}else{audio.pause();document.getElementById('playBtn').innerHTML='<svg viewBox="0 0 24 24"><path d="M8 5v14l11-7z"/></svg>'}});
document.getElementById('stopBtn').addEventListener('click',()=>{audio.pause();audio.currentTime=0;updatePlayhead();document.getElementById('playBtn').innerHTML='<svg viewBox="0 0 24 24"><path d="M8 5v14l11-7z"/></svg>'});
document.getElementById('volume').addEventListener('input',e=>audio.volume=Number(e.target.value));
document.getElementById('zoomIn').addEventListener('click',()=>{zoom=Math.min(8,zoom*1.35);drawWaveform();drawTimeline()});document.getElementById('zoomOut').addEventListener('click',()=>{zoom=Math.max(1,zoom/1.35);drawWaveform();drawTimeline()});document.getElementById('fitBtn').addEventListener('click',()=>{zoom=1;drawWaveform();drawTimeline()});
function bufferToWav(buffer){const channels=buffer.numberOfChannels,frames=buffer.length,dataSize=frames*channels*2,output=new ArrayBuffer(44+dataSize),view=new DataView(output);const write=(offset,text)=>{for(let i=0;i<text.length;i++)view.setUint8(offset+i,text.charCodeAt(i))};write(0,'RIFF');view.setUint32(4,36+dataSize,true);write(8,'WAVE');write(12,'fmt ');view.setUint32(16,16,true);view.setUint16(20,1,true);view.setUint16(22,channels,true);view.setUint32(24,buffer.sampleRate,true);view.setUint32(28,buffer.sampleRate*channels*2,true);view.setUint16(32,channels*2,true);view.setUint16(34,16,true);write(36,'data');view.setUint32(40,dataSize,true);let offset=44;for(let i=0;i<frames;i++)for(let ch=0;ch<channels;ch++){const sample=Math.max(-1,Math.min(1,buffer.getChannelData(ch)[i]));view.setInt16(offset,sample<0?sample*32768:sample*32767,true);offset+=2}return new Blob([output],{type:'audio/wav'})}
function downloadBlob(blob,name){const url=URL.createObjectURL(blob),link=document.createElement('a');link.href=url;link.download=name;link.click();setTimeout(()=>URL.revokeObjectURL(url),1500)}
document.getElementById('exportBtn').addEventListener('click',()=>{if(!audioBuffer)return;downloadBlob(bufferToWav(audioBuffer),`${currentFileName.replace(/\.[^.]+$/,'')||'kolaudio-audio'}.wav`);notify('WAV file exported.')});
function floatTo16Bit(samples){const output=new Int16Array(samples.length);for(let i=0;i<samples.length;i++){const sample=Math.max(-1,Math.min(1,samples[i]));output[i]=sample<0?sample*32768:sample*32767}return output}
async function exportMp3(){
  if(!audioBuffer)return;
  if(!window.lamejs?.Mp3Encoder){notify('MP3 encoder could not load. Check your internet connection and reload.');return}
  const button=document.getElementById('exportMp3');button.disabled=true;button.textContent='Encoding…';
  await new Promise(resolve=>setTimeout(resolve,30));
  try{
    const channels=Math.min(2,audioBuffer.numberOfChannels),bitrate=Number(document.getElementById('mp3Bitrate').value);
    const encoder=new window.lamejs.Mp3Encoder(channels,audioBuffer.sampleRate,bitrate),chunks=[],chunkSize=1152;
    const left=audioBuffer.getChannelData(0),right=channels===2?audioBuffer.getChannelData(1):null;
    for(let offset=0;offset<audioBuffer.length;offset+=chunkSize){
      const end=Math.min(offset+chunkSize,audioBuffer.length),leftChunk=floatTo16Bit(left.subarray(offset,end));
      const encoded=channels===2?encoder.encodeBuffer(leftChunk,floatTo16Bit(right.subarray(offset,end))):encoder.encodeBuffer(leftChunk);
      if(encoded.length)chunks.push(new Uint8Array(encoded));
    }
    const final=encoder.flush();if(final.length)chunks.push(new Uint8Array(final));
    downloadBlob(new Blob(chunks,{type:'audio/mpeg'}),`${currentFileName.replace(/\.[^.]+$/,'')||'kolaudio-audio'}.mp3`);
    notify(`MP3 exported at ${bitrate} kbps.`);
  }catch(error){console.error(error);notify('MP3 encoding failed. Try WAV export or another bitrate.')}
  finally{button.disabled=false;button.innerHTML='<span>↓</span> MP3'}
}
document.getElementById('exportMp3').addEventListener('click',exportMp3);
document.getElementById('muteBtn').addEventListener('click',e=>{audio.muted=!audio.muted;e.currentTarget.classList.toggle('selected',audio.muted);notify(audio.muted?'Track muted.':'Track unmuted.')});document.getElementById('soloBtn').addEventListener('click',e=>{e.currentTarget.classList.toggle('selected');notify('Solo track toggled.')});
async function startRecording(){try{const stream=await navigator.mediaDevices.getUserMedia({audio:true});recordedChunks=[];mediaRecorder=new MediaRecorder(stream);mediaRecorder.ondataavailable=e=>{if(e.data.size)recordedChunks.push(e.data)};mediaRecorder.onstop=()=>{const blob=new Blob(recordedChunks,{type:mediaRecorder.mimeType||'audio/webm'});const ext=blob.type.includes('mp4')?'m4a':'webm';stream.getTracks().forEach(t=>t.stop());document.getElementById('recordBtn').classList.remove('recording');loadAudio(new File([blob],`kolaudio-recording.${ext}`,{type:blob.type}))};mediaRecorder.start();document.getElementById('studio').hidden=false;document.getElementById('welcome').hidden=true;document.getElementById('recordBtn').classList.add('recording');notify('Recording… press the red button again to finish.')}catch{notify('Microphone access was not available. Check your browser permissions.')}}
function toggleRecord(){if(mediaRecorder?.state==='recording')mediaRecorder.stop();else startRecording()}
document.getElementById('recordBtn').addEventListener('click',toggleRecord);document.getElementById('recordIntro').addEventListener('click',()=>{document.getElementById('studio').hidden=false;document.getElementById('welcome').hidden=true;toggleRecord()});
document.getElementById('helpBtn').addEventListener('click',()=>notify('Import or record audio, then export MP3 or WAV. MP3 bitrate can be selected from 128 to 320 kbps.'));
window.addEventListener('resize',()=>{if(audioBuffer){drawWaveform();drawTimeline()}});
