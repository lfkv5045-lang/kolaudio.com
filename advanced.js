/* Additional non-destructive-until-applied audio editing tools for Kolaudio. */
(() => {
  const audioEl = document.getElementById('audio');
  const waveformEl = document.getElementById('waveform');
  const waveArea = document.getElementById('waveScroll');
  const actionBar = document.querySelector('.editbar');
  const notice = message => {
    const toast = document.getElementById('toast');
    toast.textContent = message;
    toast.classList.add('show');
    clearTimeout(notice.timer);
    notice.timer = setTimeout(() => toast.classList.remove('show'), 2800);
  };
  if (!audioEl || !waveformEl || !actionBar || typeof audioBuffer === 'undefined') return;

  const css = document.createElement('style');
  css.textContent = `
    .adv-tools{display:flex;align-items:center;gap:7px;flex-wrap:wrap;padding:9px 12px;background:#191a1f;border:1px solid #2c2d34;border-top:0}
    .adv-tools button,.adv-tools select,.adv-tools input[type=range]{accent-color:#d2f36b}
    .adv-tools button,.adv-tools select{height:29px;padding:0 9px;border:1px solid #393a42;border-radius:4px;background:#24252b;color:#d5d6db;font:10px 'DM Sans',sans-serif;cursor:pointer}
    .adv-tools button:hover,.adv-tools select:hover{border-color:#d2f36b;color:#d2f36b}.adv-tools button:disabled{opacity:.4;cursor:not-allowed}
    .adv-tools .adv-danger{color:#ff979a}.adv-tools .adv-divider{height:20px;border-left:1px solid #3c3d44;margin:0 3px}
    .voice-controls{display:flex;align-items:center;gap:8px;margin-left:auto;color:#9b9da6;font:9px 'DM Mono',monospace}
    .voice-controls select{max-width:145px}.voice-controls input{width:85px}.voice-controls output{color:#d2f36b;min-width:34px}
    .adv-help{width:100%;font-size:9px;color:#777984;margin-top:1px}
    .adv-selection{position:absolute;inset:0 auto 0 0;background:#d2f36b2b;border-left:1px solid #d2f36b;border-right:1px solid #d2f36b;pointer-events:none;z-index:2;display:none}
    .wave-scroll{touch-action:none}
    @media(max-width:760px){.adv-tools{overflow-x:auto;flex-wrap:nowrap}.adv-help{display:none}.voice-controls{margin-left:0}.voice-controls input{width:60px}}
  `;
  document.head.append(css);

  const tools = document.createElement('div');
  tools.className = 'adv-tools';
  tools.innerHTML = `
    <button data-edit="undo" title="Undo (Ctrl/Cmd+Z)">↶ Undo</button>
    <button data-edit="redo" title="Redo (Ctrl/Cmd+Shift+Z)">↷ Redo</button><span class="adv-divider"></span>
    <button data-edit="cut" title="Cut selection">Cut</button><button data-edit="copy" title="Copy selection">Copy</button>
    <button data-edit="paste" title="Paste at playhead">Paste</button><button data-edit="delete" class="adv-danger" title="Delete selection">Delete</button>
    <button data-edit="trim" title="Keep only the selected audio">Trim</button><button data-edit="silence" title="Silence selected audio">Silence</button>
    <button data-edit="duplicate" title="Duplicate selection">Duplicate</button><span class="adv-divider"></span>
    <select id="advEffect" aria-label="Audio effect"><option value="">Effects…</option><option value="normalize">Normalize</option><option value="fadeIn">Fade in</option><option value="fadeOut">Fade out</option><option value="gainUp">Amplify +3 dB</option><option value="gainDown">Reduce −3 dB</option><option value="compress">Compressor</option><option value="echo">Echo</option><option value="reverb">Reverb</option><option value="lowpass">Low-pass filter</option><option value="highpass">High-pass filter</option><option value="gate">Noise gate / cleanup</option><option value="reverse">Reverse</option><option value="invert">Invert phase</option></select>
    <div class="voice-controls"><label for="voicePreset">VOICE FX</label><select id="voicePreset" aria-label="Voice changer preset"><option value="">Choose preset…</option><option value="deep">Deep voice</option><option value="bright">Bright / chipmunk</option><option value="robot">Robot</option><option value="radio">Radio / telephone</option><option value="alien">Alien</option></select><label for="pitchAmount">PITCH</label><input id="pitchAmount" type="range" min="-12" max="12" value="0"><output id="pitchValue">0 st</output><button data-edit="voice" title="Apply selected voice effect">Apply</button></div>
    <button data-edit="wav" title="Export edited audio as WAV">Export WAV</button>
    <div class="adv-help">Drag over the waveform to select a range. Editing is applied to the selection, or the whole track when nothing is selected. Voice effects are local DSP presets, not AI voice cloning.</div>`;
  actionBar.insertAdjacentElement('afterend', tools);

  const selectionBox = document.createElement('div');
  selectionBox.className = 'adv-selection';
  waveArea.append(selectionBox);

  let range = null;
  let isDragging = false;
  let selectionStart = 0;
  let clipboard = null;
  let undoStack = [];
  let undoAt = -1;
  let renderedUrl = null;

  const clone = source => {
    const result = new AudioBuffer({length:source.length,numberOfChannels:source.numberOfChannels,sampleRate:source.sampleRate});
    for (let ch=0;ch<source.numberOfChannels;ch++) result.copyToChannel(source.getChannelData(ch).slice(),ch);
    return result;
  };
  const snapshot = () => {
    if (!audioBuffer) return;
    undoStack=undoStack.slice(0,undoAt+1); undoStack.push(clone(audioBuffer));
    if (undoStack.length>25) undoStack.shift();
    undoAt=undoStack.length-1; buttonState();
  };
  const bounds = () => {
    if (!audioBuffer) return null;
    if (range && range[1]-range[0]>1) return [Math.max(0,range[0]),Math.min(audioBuffer.length,range[1])];
    return [0,audioBuffer.length];
  };
  const selectedBounds = () => {
    if (!audioBuffer) { notice('Import or record audio first.'); return null; }
    if (!range || range[1]-range[0]<2) { notice('Drag across the waveform to select audio first.'); return null; }
    return [Math.max(0,range[0]),Math.min(audioBuffer.length,range[1])];
  };
  function updateSelection() {
    if (!audioBuffer || !range || range[1]-range[0]<2) { selectionBox.style.display='none'; range=null; }
    else {
      const duration=audioBuffer.duration/(typeof zoom==='undefined'?1:zoom);
      const left=range[0]/audioBuffer.sampleRate/duration*100;
      const right=range[1]/audioBuffer.sampleRate/duration*100;
      selectionBox.style.left=`${left}%`; selectionBox.style.width=`${Math.max(0,right-left)}%`; selectionBox.style.display='block';
    }
    const info=document.getElementById('selectionInfo');
    if (info) info.textContent=range&&audioBuffer?`${formatTime(range[0]/audioBuffer.sampleRate)} – ${formatTime(range[1]/audioBuffer.sampleRate)}`:'No selection';
    buttonState();
  }
  function buttonState() {
    const hasAudio=!!audioBuffer, hasSelection=!!range&&range[1]-range[0]>1;
    tools.querySelectorAll('[data-edit]').forEach(button=>{
      const action=button.dataset.edit;
      button.disabled=!hasAudio || (['cut','copy','delete','trim','silence','duplicate'].includes(action)&&!hasSelection) || (action==='paste'&&!clipboard) || (action==='undo'&&undoAt<=0) || (action==='redo'&&undoAt>=undoStack.length-1);
    });
  }
  function makeBuffer(channels,length,sampleRate) { return new AudioBuffer({numberOfChannels:channels,length:Math.max(1,length),sampleRate}); }
  function sliceBuffer(source,start,end) {
    const out=makeBuffer(source.numberOfChannels,end-start,source.sampleRate);
    for(let ch=0;ch<source.numberOfChannels;ch++)out.copyToChannel(source.getChannelData(ch).slice(start,end),ch);
    return out;
  }
  function spliceBuffer(source,insert,at,start=0,end=source.length) {
    const channels=Math.max(source.numberOfChannels,insert?insert.numberOfChannels:source.numberOfChannels);
    const insertLength=insert?insert.length:0;
    const out=makeBuffer(channels,at+(end-start)+insertLength,source.sampleRate);
    for(let ch=0;ch<channels;ch++){
      const sourceCh=source.getChannelData(Math.min(ch,source.numberOfChannels-1));
      const target=out.getChannelData(ch);
      target.set(sourceCh.subarray(start,at),0);
      if(insert)target.set(insert.getChannelData(Math.min(ch,insert.numberOfChannels-1)),at);
      target.set(sourceCh.subarray(end),at+insertLength);
    }
    return out;
  }
  function wavBlob(buffer) {
    const channels=buffer.numberOfChannels, size=buffer.length*channels*2;
    const data=new ArrayBuffer(44+size), view=new DataView(data);
    const text=(offset,value)=>{for(let i=0;i<value.length;i++)view.setUint8(offset+i,value.charCodeAt(i));};
    text(0,'RIFF');view.setUint32(4,36+size,true);text(8,'WAVE');text(12,'fmt ');view.setUint32(16,16,true);view.setUint16(20,1,true);view.setUint16(22,channels,true);view.setUint32(24,buffer.sampleRate,true);view.setUint32(28,buffer.sampleRate*channels*2,true);view.setUint16(32,channels*2,true);view.setUint16(34,16,true);text(36,'data');view.setUint32(40,size,true);
    let offset=44;
    for(let i=0;i<buffer.length;i++)for(let ch=0;ch<channels;ch++){const sample=Math.max(-1,Math.min(1,buffer.getChannelData(ch)[i]));view.setInt16(offset,sample<0?sample*32768:sample*32767,true);offset+=2;}
    return new Blob([data],{type:'audio/wav'});
  }
  function refresh(message) {
    if(!audioBuffer)return;
    audioEl.pause(); const blob=wavBlob(audioBuffer);
    if(renderedUrl)URL.revokeObjectURL(renderedUrl);
    renderedUrl=URL.createObjectURL(blob);audioEl.src=renderedUrl;audioEl.load();
    if(typeof drawWaveform==='function')drawWaveform();if(typeof drawTimeline==='function')drawTimeline();
    const duration=document.getElementById('duration');if(duration)duration.textContent=formatTime(audioBuffer.duration);
    const meta=document.getElementById('trackMeta');if(meta)meta.textContent=`${audioBuffer.numberOfChannels===1?'MONO':'STEREO'} · ${(audioBuffer.sampleRate/1000).toFixed(1)} KHZ`;
    updateSelection();if(message)notice(message);
  }
  function changeBuffer(next,message) { audioBuffer=next;snapshot();refresh(message); }
  function download(buffer,name) { const url=URL.createObjectURL(wavBlob(buffer));const link=document.createElement('a');link.href=url;link.download=name;link.click();setTimeout(()=>URL.revokeObjectURL(url),1200); }

  waveArea.addEventListener('pointerdown',event=>{
    if(!audioBuffer||event.target!==waveformEl)return;
    isDragging=true;waveArea.setPointerCapture(event.pointerId);
    const rect=waveformEl.getBoundingClientRect();const seconds=Math.max(0,Math.min(1,(event.clientX-rect.left)/rect.width))*audioBuffer.duration/(typeof zoom==='undefined'?1:zoom);
    selectionStart=Math.floor(seconds*audioBuffer.sampleRate);range=[selectionStart,selectionStart];updateSelection();
  });
  waveArea.addEventListener('pointermove',event=>{
    if(!isDragging||!audioBuffer)return;
    const rect=waveformEl.getBoundingClientRect();const seconds=Math.max(0,Math.min(1,(event.clientX-rect.left)/rect.width))*audioBuffer.duration/(typeof zoom==='undefined'?1:zoom);
    const here=Math.floor(seconds*audioBuffer.sampleRate);range=[Math.min(selectionStart,here),Math.max(selectionStart,here)];updateSelection();
  });
  waveArea.addEventListener('pointerup',event=>{
    if(!isDragging)return;isDragging=false;
    if(!range||range[1]-range[0]<2){range=null;const rect=waveformEl.getBoundingClientRect();audioEl.currentTime=Math.max(0,Math.min(1,(event.clientX-rect.left)/rect.width))*audioEl.duration/(typeof zoom==='undefined'?1:zoom);updateSelection();}
  });

  tools.addEventListener('click',event=>{
    const button=event.target.closest('[data-edit]');if(!button||button.disabled)return;
    const action=button.dataset.edit;const selected=selectedBounds();
    if(action==='undo'){if(undoAt>0){undoAt--;audioBuffer=clone(undoStack[undoAt]);range=null;refresh('Undo complete.');}return;}
    if(action==='redo'){if(undoAt<undoStack.length-1){undoAt++;audioBuffer=clone(undoStack[undoAt]);range=null;refresh('Redo complete.');}return;}
    if(action==='wav'){if(audioBuffer)download(audioBuffer,`${(currentFileName||'kolaudio-edit').replace(/\.[^.]+$/,'')}.wav`);return;}
    if(action==='copy'||action==='cut'){
      if(!selected)return;clipboard=sliceBuffer(audioBuffer,selected[0],selected[1]);
      if(action==='copy'){buttonState();notice('Selection copied.');return;}
    }
    if(['delete','cut'].includes(action)){if(!selected)return;range=null;changeBuffer(spliceBuffer(audioBuffer,null,selected[0],0,selected[1]),'Selection removed.');return;}
    if(action==='trim'){if(!selected)return;const next=sliceBuffer(audioBuffer,selected[0],selected[1]);range=null;changeBuffer(next,'Trimmed to selection.');return;}
    if(action==='silence'){if(!selected)return;const next=clone(audioBuffer);for(let ch=0;ch<next.numberOfChannels;ch++)next.getChannelData(ch).fill(0,selected[0],selected[1]);changeBuffer(next,'Selection silenced.');return;}
    if(action==='duplicate'){if(!selected)return;const part=sliceBuffer(audioBuffer,selected[0],selected[1]);const next=spliceBuffer(audioBuffer,part,selected[1]);range=[selected[1],selected[1]+part.length];changeBuffer(next,'Selection duplicated.');return;}
    if(action==='paste'){
      if(!clipboard||!audioBuffer)return;const at=Math.max(0,Math.min(audioBuffer.length,Math.floor(audioEl.currentTime*audioBuffer.sampleRate)));const next=spliceBuffer(audioBuffer,clipboard,at);range=[at,at+clipboard.length];changeBuffer(next,'Pasted at the playhead.');return;
    }
    if(action==='voice'){if(!audioBuffer)return;applyVoice();return;}
  });

  function processEffect(effect) {
    if(!audioBuffer)return;
    const [start,end]=bounds();const next=clone(audioBuffer);const sr=next.sampleRate;
    for(let ch=0;ch<next.numberOfChannels;ch++){
      const data=next.getChannelData(ch);const segment=data.slice(start,end);const length=segment.length;
      if(effect==='normalize'){
        let peak=0;for(const value of segment)peak=Math.max(peak,Math.abs(value));if(peak)for(let i=start;i<end;i++)data[i]*=.98/peak;
      } else if(effect==='fadeIn'||effect==='fadeOut'){
        for(let i=0;i<length;i++){const t=length<2?1:i/(length-1);data[start+i]*=effect==='fadeIn'?t:1-t;}
      } else if(effect==='gainUp'||effect==='gainDown'){
        const gain=Math.pow(10,(effect==='gainUp'?3:-3)/20);for(let i=start;i<end;i++)data[i]=Math.max(-1,Math.min(1,data[i]*gain));
      } else if(effect==='reverse')data.set(segment.reverse(),start);
      else if(effect==='invert')for(let i=start;i<end;i++)data[i]=-data[i];
      else if(effect==='gate'){
        let floor=0;for(const value of segment)floor+=value*value;floor=Math.sqrt(floor/Math.max(1,length));const threshold=Math.max(.006,floor*.22);for(let i=start;i<end;i++)if(Math.abs(data[i])<threshold)data[i]*=.12;
      } else if(effect==='compress'){
        const threshold=.22, ratio=3;for(let i=start;i<end;i++){const value=data[i],magnitude=Math.abs(value);if(magnitude>threshold)data[i]=Math.sign(value)*(threshold+(magnitude-threshold)/ratio);}
      } else if(effect==='echo'){
        const delay=Math.floor(sr*.24),decay=.32;for(let i=start+delay;i<end;i++)data[i]=Math.max(-1,Math.min(1,data[i]+data[i-delay]*decay));
      } else if(effect==='reverb'){
        const original=segment;for(let i=0;i<length;i++){let wet=0;for(const delay of [.035,.061,.089,.127]){const offset=Math.floor(sr*delay);if(i>=offset)wet+=original[i-offset]*(.22/(1+delay*8));}data[start+i]=Math.max(-1,Math.min(1,original[i]+wet));}
      } else if(effect==='lowpass'||effect==='highpass'){
        const cutoff=effect==='lowpass'?1200:220,alpha=1-Math.exp(-2*Math.PI*cutoff/sr);let previous=0,previousInput=0;
        for(let i=start;i<end;i++){const input=data[i];const low=previous+alpha*(input-previous);previous=low;data[i]=effect==='lowpass'?low:input-low;previousInput=input;}
      }
    }
    changeBuffer(next,`${effect.replace(/([A-Z])/g,' $1')} applied.`);
  }
  document.getElementById('advEffect').addEventListener('change',event=>{const effect=event.target.value;if(effect)processEffect(effect);event.target.value='';});

  function resamplePitch(source,semitones) {
    if(!semitones)return clone(source);
    const ratio=Math.pow(2,semitones/12);const out=makeBuffer(source.numberOfChannels,Math.max(1,Math.floor(source.length/ratio)),source.sampleRate);
    for(let ch=0;ch<source.numberOfChannels;ch++){
      const input=source.getChannelData(ch),output=out.getChannelData(ch);
      for(let i=0;i<output.length;i++){const pos=i*ratio,index=Math.floor(pos),fraction=pos-index;const a=input[Math.min(index,input.length-1)],b=input[Math.min(index+1,input.length-1)];output[i]=a+(b-a)*fraction;}
    }
    return out;
  }
  function applyVoice() {
    if(!audioBuffer){notice('Import or record audio first.');return;}
    const preset=document.getElementById('voicePreset').value;
    const semitones=Number(document.getElementById('pitchAmount').value);
    if(!preset&&!semitones){notice('Choose a voice preset or adjust pitch.');return;}
    const [start,end]=bounds();
    const before=sliceBuffer(audioBuffer,0,start);let section=sliceBuffer(audioBuffer,start,end);const after=sliceBuffer(audioBuffer,end,audioBuffer.length);
    const presetShift={deep:-5,bright:6,robot:0,radio:-1,alien:4}[preset]||0;
    section=resamplePitch(section,semitones+presetShift);
    for(let ch=0;ch<section.numberOfChannels;ch++){
      const data=section.getChannelData(ch);let lowState=0,phase=0;
      for(let i=0;i<data.length;i++){
        let value=data[i];
        if(preset==='robot'||preset==='alien'){
          phase+=2*Math.PI*(preset==='robot'?42:17)/section.sampleRate;
          value*=.35+.65*Math.sin(phase);
          if(preset==='robot')value=Math.tanh(value*2.7);
        } else if(preset==='radio'){
          lowState+=.35*(value-lowState);value=(value-lowState)*1.6;
        } else if(preset==='deep')value=Math.tanh(value*1.12);
        data[i]=Math.max(-1,Math.min(1,value));
      }
    }
    const combined=makeBuffer(section.numberOfChannels,before.length+section.length+after.length,section.sampleRate);
    for(let ch=0;ch<combined.numberOfChannels;ch++){
      const out=combined.getChannelData(ch);let offset=0;
      if(before.length){out.set(before.getChannelData(Math.min(ch,before.numberOfChannels-1)),offset);offset+=before.length;}
      out.set(section.getChannelData(ch),offset);offset+=section.length;
      if(after.length)out.set(after.getChannelData(Math.min(ch,after.numberOfChannels-1)),offset);
    }
    range=null;changeBuffer(combined,`Voice effect applied: ${preset||'pitch shift'}.`);
  }
  document.getElementById('pitchAmount').addEventListener('input',event=>document.getElementById('pitchValue').textContent=`${event.target.value} st`);
  document.addEventListener('keydown',event=>{
    if(event.target.matches('input,textarea,select,[contenteditable=true]'))return;
    if((event.ctrlKey||event.metaKey)&&event.key.toLowerCase()==='z'){event.preventDefault();tools.querySelector(`[data-edit="${event.shiftKey?'redo':'undo'}"]`).click();}
    else if((event.ctrlKey||event.metaKey)&&event.key.toLowerCase()==='y'){event.preventDefault();tools.querySelector('[data-edit="redo"]').click();}
    else if(event.key==='Delete'&&range)tools.querySelector('[data-edit="delete"]').click();
  });
  window.addEventListener('resize',updateSelection);
  document.getElementById('helpBtn')?.addEventListener('click',()=>notice('Drag across the waveform to select, then edit or apply effects. Voice FX are local sound effects; no voice cloning is used.'));
  buttonState();
})();
