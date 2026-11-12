/* Keeps the waveform selection legible and exposes its boundaries to assistive tech. */
(() => {
  const overlay = document.getElementById('selectionOverlay');
  const waveform = document.getElementById('waveform');
  const info = document.getElementById('selectionInfo');
  if (!overlay || !waveform || !info) return;

  const caption = document.createElement('span');
  caption.className = 'selection-caption';
  caption.setAttribute('aria-hidden', 'true');
  overlay.append(caption);

  const update = () => {
    const active = overlay.style.display !== 'none' && Number.parseFloat(overlay.style.width) > 0;
    info.classList.toggle('selection-active', active);
    if (active) {
      const times = info.textContent.trim();
      caption.textContent = times;
      overlay.setAttribute('role', 'img');
      overlay.setAttribute('aria-label', `Selected audio: ${times}`);
      waveform.setAttribute('aria-label', `Audio waveform. Selected range ${times}. Drag to change selection.`);
    } else {
      caption.textContent = '';
      overlay.removeAttribute('role');
      overlay.removeAttribute('aria-label');
      waveform.setAttribute('aria-label', 'Audio waveform. Drag to select a range; click to seek.');
    }
  };
  new MutationObserver(update).observe(overlay, {attributes:true,attributeFilter:['style']});
  new MutationObserver(update).observe(info, {childList:true,characterData:true,subtree:true});
  update();
})();
