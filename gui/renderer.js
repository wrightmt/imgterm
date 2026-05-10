'use strict';

// ─── ANSI → HTML ─────────────────────────────────────────────────────────────
const ANSI16 = [
  '#000000','#aa0000','#00aa00','#aaaa00',
  '#0000aa','#aa00aa','#00aaaa','#aaaaaa',
  '#555555','#ff5555','#55ff55','#ffff55',
  '#5555ff','#ff55ff','#55ffff','#ffffff',
];

function ansiToHtml(ansi) {
  let html = '';
  let fg = null, bg = null;
  let runFg = undefined, runBg = undefined, runText = '';
  let i = 0;
  const n = ansi.length;

  function flush() {
    if (!runText) return;
    let style = '';
    if (runFg) style += `color:${runFg};`;
    if (runBg) style += `background-color:${runBg};`;
    html += style ? `<span style="${style}">${runText}</span>` : runText;
    runText = '';
  }
  function emit(ch) {
    if (fg !== runFg || bg !== runBg) { flush(); runFg = fg; runBg = bg; }
    runText += ch === '&' ? '&amp;' : ch === '<' ? '&lt;' : ch === '>' ? '&gt;' : ch;
  }

  while (i < n) {
    const cc = ansi.charCodeAt(i);
    if (cc === 0x1b && ansi[i + 1] === '[') {
      let j = i + 2;
      while (j < n && !(ansi.charCodeAt(j) >= 0x40 && ansi.charCodeAt(j) <= 0x7e)) j++;
      if (j >= n) break;
      const cmd = ansi[j], code = ansi.substring(i + 2, j);
      i = j + 1;
      if (cmd === 'm') {
        const raw = code.split(';');
        const params = raw.length === 1 && raw[0] === '' ? [0] : raw.map(Number);
        let k = 0;
        while (k < params.length) {
          const p = params[k];
          if (p === 0) { fg = null; bg = null; }
          else if (p === 38 && params[k+1] === 2) { fg = `rgb(${params[k+2]},${params[k+3]},${params[k+4]})`; k += 4; }
          else if (p === 48 && params[k+1] === 2) { bg = `rgb(${params[k+2]},${params[k+3]},${params[k+4]})`; k += 4; }
          else if (p >= 30 && p <= 37)   fg = ANSI16[p-30];
          else if (p >= 90 && p <= 97)   fg = ANSI16[p-90+8];
          else if (p >= 40 && p <= 47)   bg = ANSI16[p-40];
          else if (p >= 100 && p <= 107) bg = ANSI16[p-100+8];
          k++;
        }
      }
    } else if (cc === 0x0d) {
      i++;
    } else if (cc === 0x0a) {
      flush(); html += '\n'; i++;
    } else {
      const cp = ansi.codePointAt(i); emit(ansi[i]); i += cp > 0xffff ? 2 : 1;
    }
  }
  flush();
  return html;
}

// ─── Mode metadata ────────────────────────────────────────────────────────────
const MODE_INFO = [
  { id: 'normal',       label: 'normal',       desc: '24-bit full color'      },
  { id: 'green',        label: 'green',        desc: 'P1 phosphor'            },
  { id: 'amber',        label: 'amber',        desc: 'P3 phosphor'            },
  { id: 'grunge',       label: 'grunge',       desc: 'scanlines + noise'      },
  { id: 'green-grunge', label: 'green-grunge', desc: 'green + grunge'         },
  { id: 'amber-grunge', label: 'amber-grunge', desc: 'amber + grunge'         },
  { id: 'ascii',        label: 'ascii',        desc: 'density art'            },
  { id: 'ascii-green',  label: 'ascii-green',  desc: 'density + green'        },
  { id: 'ascii-amber',  label: 'ascii-amber',  desc: 'density + amber'        },
  { id: '16color',      label: '16color',      desc: 'Bayer dithered'         },
  { id: 'rainbow',      label: 'rainbow',      desc: 'full spectrum sweep'    },
  { id: 'thermal',      label: 'thermal',      desc: 'heat map gradient'      },
  { id: 'neon',         label: 'neon',         desc: 'max sat + hue shift'    },
  { id: 'glitch',       label: 'glitch',       desc: 'digital corruption'     },
  { id: 'custom',       label: 'custom',       desc: 'user phosphor color'    },
];

// ─── Console panel ────────────────────────────────────────────────────────────
const consoleHeader  = document.getElementById('consoleHeader');
const consoleBody    = document.getElementById('consoleBody');
const consoleOutput  = document.getElementById('consoleOutput');
const consoleInput   = document.getElementById('consoleInput');
const consoleSend    = document.getElementById('consoleSend');
const consoleClear   = document.getElementById('consoleClear');
const consoleChevron = document.getElementById('consoleChevron');

let consoleOpen = false;

function toggleConsole(forceOpen) {
  consoleOpen = forceOpen !== undefined ? forceOpen : !consoleOpen;
  consoleBody.style.display      = consoleOpen ? 'flex' : 'none';
  consoleChevron.style.transform = consoleOpen ? 'rotate(180deg)' : '';
}

consoleHeader.addEventListener('click', () => toggleConsole());
consoleClear.addEventListener('click', e => { e.stopPropagation(); consoleOutput.innerHTML = ''; });

function stripAnsi(s) { return s.replace(/\x1b\[[0-9;]*[A-Za-z]/g, '').replace(/\r/g, ''); }

function appendConsole(text, type) {
  const clean = stripAnsi(text);
  if (!clean) return;
  const span = document.createElement('span');
  span.className = `con-${type}`;
  span.textContent = clean;
  consoleOutput.appendChild(span);
  const near = consoleOutput.scrollHeight - consoleOutput.scrollTop - consoleOutput.clientHeight < 60;
  if (near) consoleOutput.scrollTop = consoleOutput.scrollHeight;
}

window.api.onConsoleData(({ text, type }) => appendConsole(text, type));

function sendConsoleInput() {
  const val = consoleInput.value; if (!val) return;
  appendConsole(`> ${val}\n`, 'input');
  window.api.consoleWrite(val + '\n');
  consoleInput.value = '';
}
consoleInput.addEventListener('keydown', e => { if (e.key === 'Enter') sendConsoleInput(); });
consoleSend.addEventListener('click', sendConsoleInput);

// ─── DOM refs ─────────────────────────────────────────────────────────────────
const dropZone       = document.getElementById('dropZone');
const fileInput      = document.getElementById('fileInput');
const browseBtn      = document.getElementById('browseBtn');
const thumb          = document.getElementById('thumb');
const dropHint       = document.getElementById('dropHint');
const imagePathEl    = document.getElementById('imagePath');
const widthEl        = document.getElementById('width');
const rowsEl         = document.getElementById('rows');
const sshHostEl      = document.getElementById('sshHost');
const sshPortEl      = document.getElementById('sshPort');
const sshUserEl      = document.getElementById('sshUser');
const sshPassEl      = document.getElementById('sshPass');
const remotePathEl   = document.getElementById('remotePath');
const remotePathHint = document.getElementById('remotePathHint');
const remotePathLabel= document.getElementById('remotePathLabel');
const deployModeEl   = document.getElementById('deployMode');
const useSudoEl      = document.getElementById('useSudo');
const sudoPassEl     = document.getElementById('sudoPass');
const sudoPassField  = document.getElementById('sudoPassField');
const previewBtn     = document.getElementById('previewBtn');
const testSshBtn     = document.getElementById('testSshBtn');
const exportBtn      = document.getElementById('exportBtn');
const deployBtn      = document.getElementById('deployBtn');
const statusEl       = document.getElementById('status');
const styleGridWrap  = document.getElementById('styleGridWrap');
const styleGridEl    = document.getElementById('styleGrid');
const previewScroll  = document.getElementById('previewScroll');
const ansiPre        = document.getElementById('ansiPre');
const previewLabel   = document.getElementById('previewLabel');
const previewMeta    = document.getElementById('previewMeta');
const changeStyleBtn  = document.getElementById('changeStyleBtn');
const regenerateBtn   = document.getElementById('regenerateBtn');
const sshIndicator    = document.getElementById('sshIndicator');
const exportModal     = document.getElementById('exportModal');
const adjBrightness   = document.getElementById('adjBrightness');
const adjContrast     = document.getElementById('adjContrast');
const adjSaturation   = document.getElementById('adjSaturation');
const adjInvert       = document.getElementById('adjInvert');
const adjBrightnessVal= document.getElementById('adjBrightnessVal');
const adjContrastVal  = document.getElementById('adjContrastVal');
const adjSaturationVal= document.getElementById('adjSaturationVal');
const adjReset        = document.getElementById('adjReset');
const customColorEl   = document.getElementById('customColor');
const customColorHex  = document.getElementById('customColorHex');

// ─── State ───────────────────────────────────────────────────────────────────
let selectedPath = null;
let currentAnsi  = null;
let selectedMode = null;
let cachedGrid   = null;  // results from last run-imgterm-all

// ─── Adjustments ──────────────────────────────────────────────────────────────
function getAdjustments() {
  return {
    brightness: parseInt(adjBrightness.value),
    contrast:   parseInt(adjContrast.value),
    saturation: parseInt(adjSaturation.value),
    invert:     adjInvert.checked,
  };
}

function isDefaultAdjustments({ brightness, contrast, saturation, invert }) {
  return brightness === 0 && contrast === 0 && saturation === 0 && !invert;
}

function updateThumbnailFilter() {
  const { brightness, contrast, saturation, invert } = getAdjustments();
  const f = [];
  if (invert)        f.push('invert(1)');
  if (brightness)    f.push(`brightness(${1 + brightness / 100})`);
  if (contrast)      f.push(`contrast(${1 + contrast / 100})`);
  if (saturation)    f.push(`saturate(${1 + saturation / 100})`);
  thumb.style.filter = f.join(' ');
}

function applyPixelAdjustments(data, brightness, contrast, saturation, invert) {
  const bAdd    = brightness * 2.55;
  const cFactor = 1 + contrast   / 100;
  const sFactor = 1 + saturation / 100;
  for (let i = 0; i < data.length; i += 4) {
    let r = data[i], g = data[i + 1], b = data[i + 2];
    if (invert) { r = 255 - r; g = 255 - g; b = 255 - b; }
    r += bAdd; g += bAdd; b += bAdd;
    r = (r - 128) * cFactor + 128;
    g = (g - 128) * cFactor + 128;
    b = (b - 128) * cFactor + 128;
    const lum = 0.2126 * r + 0.7152 * g + 0.0722 * b;
    r = lum + (r - lum) * sFactor;
    g = lum + (g - lum) * sFactor;
    b = lum + (b - lum) * sFactor;
    data[i]     = Math.max(0, Math.min(255, r));
    data[i + 1] = Math.max(0, Math.min(255, g));
    data[i + 2] = Math.max(0, Math.min(255, b));
  }
}

async function prepareImageForRender() {
  const adj = getAdjustments();
  if (isDefaultAdjustments(adj)) return { path: selectedPath, isTemp: false };

  const img = new Image();
  await new Promise((res, rej) => {
    img.onload = res; img.onerror = rej;
    img.src = 'file:///' + selectedPath.replace(/\\/g, '/');
  });
  const canvas = document.createElement('canvas');
  canvas.width = img.naturalWidth; canvas.height = img.naturalHeight;
  const ctx = canvas.getContext('2d');
  ctx.drawImage(img, 0, 0);
  const id = ctx.getImageData(0, 0, canvas.width, canvas.height);
  applyPixelAdjustments(id.data, adj.brightness, adj.contrast, adj.saturation, adj.invert);
  ctx.putImageData(id, 0, 0);
  const base64 = canvas.toDataURL('image/png').split(',')[1];
  const tmpPath = await window.api.writeTemp(base64);
  return { path: tmpPath, isTemp: true };
}

// Slider value display + thumbnail filter update
[
  [adjBrightness, adjBrightnessVal],
  [adjContrast,   adjContrastVal],
  [adjSaturation, adjSaturationVal],
].forEach(([slider, valEl]) => {
  slider.addEventListener('input', () => {
    valEl.textContent = slider.value;
    updateThumbnailFilter();
  });
});
adjInvert.addEventListener('change', updateThumbnailFilter);

customColorEl.addEventListener('input', () => {
  customColorHex.textContent = customColorEl.value;
});

adjReset.addEventListener('click', () => {
  adjBrightness.value = 0; adjBrightnessVal.textContent = '0';
  adjContrast.value   = 0; adjContrastVal.textContent   = '0';
  adjSaturation.value = 0; adjSaturationVal.textContent = '0';
  adjInvert.checked   = false;
  updateThumbnailFilter();
});

// ─── View helpers ─────────────────────────────────────────────────────────────
function showGrid() {
  styleGridWrap.classList.remove('hidden');
  previewScroll.classList.add('hidden');
  changeStyleBtn.classList.add('hidden');
  regenerateBtn.classList.add('hidden');
  previewLabel.textContent = 'Select a style';
  previewMeta.textContent  = '';
}

function showFullPreview(mode, ansi) {
  currentAnsi  = ansi;
  selectedMode = mode;
  const info   = MODE_INFO.find(m => m.id === mode);
  const lines  = (ansi.match(/\n/g) || []).length;
  const cols   = parseInt(widthEl.value) || 80;

  ansiPre.innerHTML = ansiToHtml(ansi);
  styleGridWrap.classList.add('hidden');
  previewScroll.classList.remove('hidden');
  changeStyleBtn.classList.remove('hidden');
  regenerateBtn.classList.remove('hidden');
  previewLabel.textContent = info ? `${info.label}` : mode;
  previewMeta.textContent  = `${cols} cols × ${lines} rows  ·  ${info ? info.desc : ''}`;

  deployBtn.disabled = false;
  exportBtn.disabled = false;
}

// ─── Image selection ──────────────────────────────────────────────────────────
function setImage(filePath) {
  selectedPath = filePath;
  imagePathEl.value = filePath;
  previewBtn.disabled = false;
  cachedGrid = null;
  currentAnsi = null;
  selectedMode = null;
  deployBtn.disabled = true;
  exportBtn.disabled = true;

  thumb.src = 'file:///' + filePath.replace(/\\/g, '/');
  thumb.style.filter = '';
  thumb.classList.remove('hidden');
  dropHint.classList.add('hidden');

  // Auto-render the style grid
  renderStyleGrid();
}

dropZone.addEventListener('click', () => fileInput.click());
fileInput.addEventListener('change', () => { const f = fileInput.files[0]; if (f?.path) setImage(f.path); });
browseBtn.addEventListener('click', async e => {
  e.stopPropagation();
  const p = await window.api.openFileDialog();
  if (p) setImage(p);
});
dropZone.addEventListener('dragover', e => { e.preventDefault(); dropZone.classList.add('drag-over'); });
dropZone.addEventListener('dragleave', () => dropZone.classList.remove('drag-over'));
dropZone.addEventListener('drop', e => {
  e.preventDefault(); dropZone.classList.remove('drag-over');
  const f = e.dataTransfer.files[0]; if (f?.path) setImage(f.path);
});

// ─── Recent hosts ─────────────────────────────────────────────────────────────
const recentHostsList = document.getElementById('recentHostsList');
const RECENT_HOSTS_KEY = 'imgterm-recent-hosts';

function loadRecentHosts() {
  try { return JSON.parse(localStorage.getItem(RECENT_HOSTS_KEY)) || []; }
  catch { return []; }
}

function saveRecentHost(host) {
  const trimmed = host.trim();
  if (!trimmed) return;
  const list = [trimmed, ...loadRecentHosts().filter(h => h !== trimmed)].slice(0, 5);
  localStorage.setItem(RECENT_HOSTS_KEY, JSON.stringify(list));
  renderRecentHosts();
}

function renderRecentHosts() {
  const list = loadRecentHosts();
  recentHostsList.innerHTML = '';
  list.forEach(host => {
    const chip = document.createElement('button');
    chip.className = 'recent-host-chip';
    chip.textContent = host;
    chip.title = host;
    chip.addEventListener('click', () => { sshHostEl.value = host; });
    recentHostsList.appendChild(chip);
  });
}

renderRecentHosts();

// ─── SSH indicator ────────────────────────────────────────────────────────────
function updateSshIndicator() {
  const host = sshHostEl.value.trim();
  const user = sshUserEl.value.trim();
  sshIndicator.classList.remove('ready', 'partial');
  if (host && user)    sshIndicator.classList.add('ready');
  else if (host || user) sshIndicator.classList.add('partial');
}
[sshHostEl, sshUserEl, sshPassEl].forEach(el => el.addEventListener('input', updateSshIndicator));
updateSshIndicator();

// ─── Deploy-mode toggle ───────────────────────────────────────────────────────
const DEPLOY_MODES = {
  'standard':       { label: 'Remote Path',    path: '/etc/motd',         hint: null },
  'ubuntu-profile': { label: 'ANSI data file', path: '/etc/motd.imgterm', hint: 'ANSI stored here → sourced via /etc/profile.d/imgterm-motd.sh (runs in shell, ANSI works)' },
  'ubuntu-motd':    { label: 'ANSI data file', path: '/etc/motd.imgterm', hint: 'ANSI stored here → /etc/update-motd.d/00-imgterm (PAM path — ANSI may not render)' },
};

function applyDeployMode() {
  const cfg = DEPLOY_MODES[deployModeEl.value] || DEPLOY_MODES['standard'];
  remotePathLabel.textContent = cfg.label;
  remotePathEl.value          = cfg.path;
  remotePathHint.textContent  = cfg.hint || '';
  remotePathHint.classList.toggle('hidden', !cfg.hint);
}
deployModeEl.addEventListener('change', applyDeployMode);
applyDeployMode();

useSudoEl.addEventListener('change', () => {
  sudoPassField.style.display = useSudoEl.checked ? '' : 'none';
});

// ─── Style grid ───────────────────────────────────────────────────────────────
function makeLoadingCard(info) {
  const el = document.createElement('div');
  el.className = 'style-card loading';
  el.innerHTML = `
    <div class="sc-bar">
      <div class="sc-dots"><i class="dot-r"></i><i class="dot-y"></i><i class="dot-g"></i></div>
      <span class="sc-title">${info.label}</span>
      <span class="sc-desc">${info.desc}</span>
    </div>
    <div class="sc-body"><div class="sc-loading">rendering…</div></div>`;
  return el;
}

function makeStyleCard(info, ansi, error) {
  const el = document.createElement('div');
  el.className = 'style-card';
  el.dataset.mode = info.id;

  const body = error
    ? `<div class="sc-error">${error}</div>`
    : `<pre class="ansi-pre sc-pre">${ansiToHtml(ansi)}</pre>`;

  el.innerHTML = `
    <div class="sc-bar">
      <div class="sc-dots"><i class="dot-r"></i><i class="dot-y"></i><i class="dot-g"></i></div>
      <span class="sc-title">${info.label}</span>
      <span class="sc-desc">${info.desc}</span>
    </div>
    <div class="sc-body">${body}</div>`;

  if (!error) {
    el.addEventListener('click', () => selectStyle(info));
  } else {
    el.classList.add('sc-has-error');
  }
  return el;
}

async function renderStyleGrid() {
  if (!selectedPath) return;
  showGrid();

  // Placeholder loading cards
  styleGridEl.innerHTML = '';
  MODE_INFO.forEach(info => styleGridEl.appendChild(makeLoadingCard(info)));
  setStatus('Rendering all styles…', 'info');
  previewBtn.disabled = true;

  let imgData;
  try {
    imgData = await prepareImageForRender();
    const results = await window.api.runImgtermAll({
      imagePath: imgData.path,
      width: 42,
      rows: 14,
      customColor: customColorEl.value,
    });
    cachedGrid = results;
    styleGridEl.innerHTML = '';
    results.forEach(({ mode, ansi, error }) => {
      styleGridEl.appendChild(makeStyleCard(MODE_INFO.find(m => m.id === mode), ansi, error));
    });
    setStatus('Click a style to preview it at full size.', 'ok');
  } catch (err) {
    styleGridEl.innerHTML = `<div class="grid-placeholder">${err.message}</div>`;
    setStatus(`Error: ${err.message}`, 'err');
  } finally {
    if (imgData?.isTemp) window.api.deleteTemp(imgData.path);
    previewBtn.disabled = !selectedPath;
  }
}

async function selectStyle(info) {
  const cols = parseInt(widthEl.value) || 80;
  const rows = rowsEl.value ? parseInt(rowsEl.value) : null;

  setStatus(`Rendering ${info.label} at ${cols} cols…`, 'info');
  deployBtn.disabled = true;
  exportBtn.disabled = true;

  // Visual feedback while running
  document.querySelectorAll('.style-card').forEach(c => {
    c.classList.toggle('sc-selected',   c.dataset.mode === info.id);
    c.classList.toggle('sc-deselected', c.dataset.mode !== info.id);
  });

  let imgData;
  try {
    imgData = await prepareImageForRender();
    const ansi = await window.api.runImgterm({ imagePath: imgData.path, mode: info.id, width: cols, rows, customColor: customColorEl.value });
    showFullPreview(info.id, ansi);
    setStatus(`${info.label} — ready to export or deploy.`, 'ok');
  } catch (err) {
    document.querySelectorAll('.style-card').forEach(c => c.classList.remove('sc-selected', 'sc-deselected'));
    setStatus(`Error: ${err.message}`, 'err');
  } finally {
    if (imgData?.isTemp) window.api.deleteTemp(imgData.path);
  }
}

// "← All styles" button
changeStyleBtn.addEventListener('click', () => {
  if (cachedGrid) {
    styleGridEl.innerHTML = '';
    cachedGrid.forEach(({ mode, ansi, error }) => {
      styleGridEl.appendChild(makeStyleCard(MODE_INFO.find(m => m.id === mode), ansi, error));
    });
  }
  showGrid();
  currentAnsi  = null;
  selectedMode = null;
  deployBtn.disabled = true;
  exportBtn.disabled = true;
});

// "↺ Regenerate" button — re-renders the current style at current settings
regenerateBtn.addEventListener('click', async () => {
  if (!selectedPath || !selectedMode) return;
  const cols = parseInt(widthEl.value) || 80;
  const rows = rowsEl.value ? parseInt(rowsEl.value) : null;
  setStatus(`Regenerating ${selectedMode} at ${cols} cols…`, 'info');
  regenerateBtn.disabled = true;
  let imgData;
  try {
    imgData = await prepareImageForRender();
    const ansi = await window.api.runImgterm({ imagePath: imgData.path, mode: selectedMode, width: cols, rows, customColor: customColorEl.value });
    showFullPreview(selectedMode, ansi);
    setStatus(`${selectedMode} — ready to export or deploy.`, 'ok');
  } catch (err) {
    setStatus(`Error: ${err.message}`, 'err');
  } finally {
    if (imgData?.isTemp) window.api.deleteTemp(imgData.path);
    regenerateBtn.disabled = false;
  }
});

// "Preview Styles" button — re-runs all modes
previewBtn.addEventListener('click', () => {
  cachedGrid = null;
  renderStyleGrid();
});

// ─── Export ───────────────────────────────────────────────────────────────────
exportBtn.addEventListener('click', async () => {
  if (!currentAnsi) return;

  // Build a default filename from the image name + selected mode
  const base = selectedPath
    ? selectedPath.replace(/\\/g, '/').split('/').pop().replace(/\.[^.]+$/, '')
    : 'motd';
  const defaultName = `${base}_${selectedMode || 'ansi'}.ans`;

  const savedPath = await window.api.exportAnsi({ content: currentAnsi, defaultName });
  if (savedPath) {
    setStatus(`Exported → ${savedPath}`, 'ok');
    showExportModal(savedPath);
  }
});

// ─── Export modal ─────────────────────────────────────────────────────────────
function showExportModal(filePath) {
  document.getElementById('exportedPath').textContent = filePath;

  document.getElementById('ubuntuInstr').textContent =
`# 1. Copy the file to your server
scp "${filePath}" user@server:/tmp/motd.ans

# 2. On the server — install ANSI data and create the profile.d hook:
sudo cp /tmp/motd.ans /etc/motd.imgterm
sudo sh -c 'printf "#!/bin/sh\\n[ -f /etc/motd.imgterm ] && cat /etc/motd.imgterm\\n" \\
  > /etc/profile.d/imgterm-motd.sh'
sudo chmod 755 /etc/profile.d/imgterm-motd.sh

# 3. Test (open a new login shell):
ssh user@server`;

  document.getElementById('standardInstr').textContent =
`# Copy directly to /etc/motd
scp "${filePath}" user@server:/tmp/motd.ans
ssh user@server 'sudo cp /tmp/motd.ans /etc/motd'

# Verify:
ssh user@server 'cat /etc/motd'`;

  document.getElementById('oneshotInstr').textContent =
`# Standard — pipe directly into /etc/motd (no temp file needed):
ssh user@server 'sudo tee /etc/motd > /dev/null' < "${filePath}"

# Ubuntu profile.d — two commands:
scp "${filePath}" user@server:/etc/motd.imgterm
ssh user@server 'sudo sh -c "printf \\"#!/bin/sh\\\\n[ -f /etc/motd.imgterm ] && cat /etc/motd.imgterm\\\\n\\" > /etc/profile.d/imgterm-motd.sh && chmod 755 /etc/profile.d/imgterm-motd.sh"'`;

  activateTab('ubuntu');
  exportModal.classList.remove('hidden');
}

function activateTab(id) {
  document.querySelectorAll('.instr-tab').forEach(t   => t.classList.toggle('active', t.dataset.tab === id));
  document.querySelectorAll('.instr-panel').forEach(p => p.classList.toggle('active', p.id === `tab-${id}`));
}

document.querySelectorAll('.instr-tab').forEach(tab => {
  tab.addEventListener('click', () => activateTab(tab.dataset.tab));
});

document.getElementById('modalClose').addEventListener('click', () => exportModal.classList.add('hidden'));
exportModal.addEventListener('click', e => { if (e.target === exportModal) exportModal.classList.add('hidden'); });

document.querySelectorAll('.copy-btn').forEach(btn => {
  const origText = btn.textContent;
  btn.addEventListener('click', () => {
    const text = document.getElementById(btn.dataset.src)?.textContent || '';
    navigator.clipboard.writeText(text).then(() => {
      btn.textContent = 'Copied!';
      setTimeout(() => { btn.textContent = origText; }, 1600);
    });
  });
});

// ─── Test SSH ─────────────────────────────────────────────────────────────────
testSshBtn.addEventListener('click', async () => {
  const host     = sshHostEl.value.trim();
  const port     = sshPortEl.value;
  const username = sshUserEl.value.trim();
  const password = sshPassEl.value;

  if (!host || !username) { setStatus('Enter SSH host and username.', 'err'); return; }

  setStatus(`Testing connection to ${username}@${host}…`, 'info');
  testSshBtn.disabled = true;
  toggleConsole(true);
  appendConsole(`──── MOTD Test ${new Date().toLocaleTimeString()} ────\n`, 'sys');
  try {
    const motd = await window.api.testSsh({ host, port, username, password, remotePath: remotePathEl.value.trim() });
    if (motd && motd.trim()) {
      ansiPre.innerHTML = ansiToHtml(motd);
      styleGridWrap.classList.add('hidden');
      previewScroll.classList.remove('hidden');
      regenerateBtn.classList.add('hidden');
      changeStyleBtn.classList.remove('hidden');
      previewLabel.textContent = 'MOTD Preview';
      previewMeta.textContent  = `live from ${host}`;
    }
    setStatus(`Connected to ${username}@${host} — MOTD rendered.`, 'ok');
  } catch (err) {
    setStatus(`Login failed: ${err.message}`, 'err');
    appendConsole(`Error: ${err.message}\n`, 'err');
  } finally {
    testSshBtn.disabled = false;
  }
});

// ─── Deploy ───────────────────────────────────────────────────────────────────
deployBtn.addEventListener('click', async () => {
  if (!currentAnsi) return;
  const host       = sshHostEl.value.trim();
  const port       = sshPortEl.value;
  const username   = sshUserEl.value.trim();
  const password   = sshPassEl.value;
  const remotePath = remotePathEl.value.trim() || '/etc/motd';
  const useSudo    = useSudoEl.checked;
  const sudoPassword = sudoPassEl.value || null;

  if (!host || !username) { setStatus('Enter SSH host and username.', 'err'); return; }

  setStatus(`Connecting to ${username}@${host}…`, 'info');
  deployBtn.disabled = true;
  toggleConsole(true);
  appendConsole(`──── Deploy ${new Date().toLocaleTimeString()} ────\n`, 'sys');

  try {
    await window.api.deployMotd({
      host, port, username, password,
      remotePath, content: currentAnsi,
      useSudo, sudoPassword,
      deployMode: deployModeEl.value,
    });
    saveRecentHost(host);
    setStatus(`Deployed to ${host}:${remotePath}`, 'ok');
  } catch (err) {
    setStatus(`Deploy failed: ${err.message}`, 'err');
  } finally {
    deployBtn.disabled = false;
  }
});

// ─── Status ───────────────────────────────────────────────────────────────────
function setStatus(msg, type) {
  statusEl.textContent = msg;
  statusEl.className = `status-bar ${type}`;
}

setStatus('Drop an image to begin. Fill SSH Target to deploy.', '');
