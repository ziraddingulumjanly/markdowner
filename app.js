const input = document.getElementById('file');
const dropzone = document.getElementById('dropzone');
const choose = document.getElementById('choose');
const process = document.getElementById('process');
const processSymbol = document.getElementById('process-symbol');
const processHeading = document.getElementById('process-heading');
const processDetail = document.getElementById('process-detail');
const progressTrack = document.getElementById('progress-track');
const progressFill = document.getElementById('progress-fill');
let busy = false;

function showProgress(message, percentage = 5) {
  process.hidden = false;
  processSymbol.innerHTML = '<span class="spinner"></span>';
  processHeading.textContent = 'Converting to Markdown...';
  processDetail.textContent = message;
  progressTrack.hidden = false;
  progressFill.style.width = `${percentage}%`;
  progressTrack.setAttribute('aria-valuenow', String(percentage));
}

function showComplete(filename) {
  processSymbol.innerHTML = '<svg class="success-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><path d="m7.5 12 3 3 6-6"/></svg>';
  processHeading.textContent = 'Conversion complete!';
  processDetail.textContent = `${filename} is ready. Your download should start automatically.`;
  progressTrack.hidden = true;
}

function showError(message) {
  process.hidden = false;
  processSymbol.innerHTML = '<svg class="error-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><path d="M12 7v6M12 17h.01"/></svg>';
  processHeading.textContent = 'Conversion failed';
  processDetail.textContent = message;
  progressTrack.hidden = true;
}

function openPicker() {
  if (!busy) input.click();
}

dropzone.addEventListener('click', openPicker);
choose.addEventListener('click', event => { event.stopPropagation(); openPicker(); });
dropzone.addEventListener('keydown', event => {
  if (event.target === dropzone && (event.key === 'Enter' || event.key === ' ')) {
    event.preventDefault();
    openPicker();
  }
});

for (const type of ['dragenter', 'dragover']) {
  dropzone.addEventListener(type, event => {
    event.preventDefault();
    if (!busy) dropzone.classList.add('dragging');
  });
}
for (const type of ['dragleave', 'drop']) {
  dropzone.addEventListener(type, event => {
    event.preventDefault();
    dropzone.classList.remove('dragging');
  });
}
dropzone.addEventListener('drop', event => {
  if (!busy && event.dataTransfer?.files?.length) handleFile(event.dataTransfer.files[0]);
});
input.addEventListener('change', () => {
  const file = input.files?.[0];
  if (file) handleFile(file);
  input.value = '';
});

async function handleFile(file) {
  if (busy) return;
  const extension = file.name.split('.').pop().toLowerCase();
  if (!['pdf', 'epub'].includes(extension)) {
    showError('Please choose a PDF or EPUB file.');
    return;
  }

  busy = true;
  choose.disabled = true;
  dropzone.classList.add('busy');
  showProgress(`Preparing ${file.name}...`);

  try {
    const markdown = extension === 'pdf' ? await convertPdf(file) : await convertEpub(file);
    if (!markdown.trim()) throw new Error('No readable text found in this file.');
    const filename = file.name.replace(/\.[^.]+$/, '') + '.md';
    showComplete(filename);
    downloadText(markdown, filename);
  } catch (error) {
    console.error('Conversion error:', error);
    showError(error.message || 'Conversion failed. Please try another file.');
  } finally {
    busy = false;
    choose.disabled = false;
    dropzone.classList.remove('busy');
  }
}

async function convertPdf(file) {
  // Load PDF.js only for PDFs, so EPUB conversion never depends on PDF.js.
  const pdfjs = await import('https://cdnjs.cloudflare.com/ajax/libs/pdf.js/4.10.38/pdf.min.mjs');
  pdfjs.GlobalWorkerOptions.workerSrc = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/4.10.38/pdf.worker.min.mjs';
  const pdf = await pdfjs.getDocument({ data: new Uint8Array(await file.arrayBuffer()) }).promise;
  const pages = [];

  try {
    for (let index = 1; index <= pdf.numPages; index++) {
      showProgress(`Reading PDF page ${index} of ${pdf.numPages}...`, Math.min(95, Math.round(index / pdf.numPages * 90)));
      const page = await pdf.getPage(index);
      const { items } = await page.getTextContent();
      const lines = [];
      let line = '';
      let previous = null;

      const finishLine = () => {
        if (line.trim()) lines.push(line.replace(/\s+/g, ' ').trim());
        line = '';
      };

      for (const item of items) {
        if (typeof item.str !== 'string') continue;
        const y = item.transform[5];
        const x = item.transform[4];
        const size = Math.abs(item.transform[3]) || item.height || 12;

        if (previous && Math.abs(y - previous.y) > Math.max(2, size * 0.35)) {
          finishLine();
          if (Math.abs(y - previous.y) > size * 1.65 && lines.length) lines.push('');
        } else if (line && previous && x - previous.end > size * 0.12) {
          line += ' ';
        }

        line += item.str;
        previous = { y, end: x + (item.width || 0), size };
        if (item.hasEOL) finishLine();
      }
      finishLine();
      if (lines.length) pages.push(lines.join('\n'));
    }
  } finally {
    await pdf.destroy();
  }

  if (!pages.length) {
    throw new Error('No selectable text found. Scanned/image PDFs need OCR (not included yet).');
  }
  return pages.join('\n\n---\n\n').trim() + '\n';
}

function getXml(text) {
  const xml = new DOMParser().parseFromString(text, 'application/xml');
  if (xml.querySelector('parsererror')) throw new Error('EPUB contains invalid XML.');
  return xml;
}

function xmlElements(node, name) {
  return Array.from(node.getElementsByTagName('*')).filter(element => element.localName === name);
}

function zipPath(baseFile, relative) {
  // Resolve EPUB links relative to the .opf file; never fetch web resources.
  const path = new URL(relative, 'https://epub.invalid/' + baseFile).pathname;
  return decodeURIComponent(path.replace(/^\//, ''));
}

async function convertEpub(file) {
  if (typeof JSZip === 'undefined' || typeof TurndownService === 'undefined') {
    throw new Error('The converter libraries could not load. Check your internet connection.');
  }
  const zip = await JSZip.loadAsync(file);
  const containerFile = zip.file('META-INF/container.xml');
  if (!containerFile) throw new Error('This is not a valid EPUB.');

  const container = getXml(await containerFile.async('string'));
  const root = xmlElements(container, 'rootfile')[0];
  const opfPath = root?.getAttribute('full-path');
  if (!opfPath || !zip.file(opfPath)) throw new Error('Cannot find EPUB book contents.');

  const packageXml = getXml(await zip.file(opfPath).async('string'));
  const manifest = new Map(xmlElements(packageXml, 'item').map(item => [
    item.getAttribute('id'), item.getAttribute('href')
  ]));
  const spine = xmlElements(packageXml, 'itemref');
  const turndown = new TurndownService({
    headingStyle: 'atx', bulletListMarker: '-', codeBlockStyle: 'fenced'
  });
  turndown.remove(['script', 'style', 'svg', 'img']);
  const chapters = [];

  for (let index = 0; index < spine.length; index++) {
    const entry = spine[index];
    if (entry.getAttribute('linear') === 'no') continue;
    const href = manifest.get(entry.getAttribute('idref'));
    if (!href) continue;
    const chapterFile = zip.file(zipPath(opfPath, href.split('#')[0].split('?')[0]));
    if (!chapterFile) continue;

    showProgress(`Reading EPUB section ${index + 1} of ${spine.length}...`, Math.min(95, Math.round((index + 1) / spine.length * 90)));
    const source = await chapterFile.async('string');
    let chapter = new DOMParser().parseFromString(source, 'application/xhtml+xml');
    if (chapter.querySelector('parsererror')) {
      chapter = new DOMParser().parseFromString(source, 'text/html');
    }
    const body = xmlElements(chapter, 'body')[0] || chapter.body;
    if (!body) continue;

    const markdown = turndown.turndown(body.innerHTML)
      .replace(/\n{4,}/g, '\n\n\n').trim();
    if (markdown) chapters.push(markdown);
  }

  if (!chapters.length) throw new Error('No readable chapters found. DRM-protected EPUBs are not supported.');
  return chapters.join('\n\n') + '\n';
}

function downloadText(text, filename) {
  const blob = new Blob([text], { type: 'text/markdown;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 30000);
}
