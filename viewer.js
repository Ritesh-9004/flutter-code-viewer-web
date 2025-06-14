// globals
let filesMap = new Map();
let namePathMap = new Map();
let mdNavStack = [];
const fileTextCache = new Map(); // Preloaded file contents

// --- FONT CONTROLS ---
function increaseFont() {
  const r = document.documentElement;
  const s = parseInt(getComputedStyle(r).getPropertyValue('--code-font-size'));
  r.style.setProperty('--code-font-size', (s + 2) + 'px');
}
function decreaseFont() {
  const r = document.documentElement;
  const s = parseInt(getComputedStyle(r).getPropertyValue('--code-font-size'));
  r.style.setProperty('--code-font-size', Math.max(s - 2, 8) + 'px');
}

function resetFont() {
  document.documentElement.style.setProperty('--code-font-size', '14px');
}

// --- VISIBILITY TOGGLERS ---
function toggleLineNumbers() {
  document.querySelectorAll('pre').forEach(p => p.classList.toggle('line-numbers'));
}
function toggleSidebar() {
  document.getElementById('container').classList.toggle('sidebar-hidden');
}


// --- PLACEHOLDER & CLOSE ---
function showPlaceholder(message = "Click a file to view its content.") {
  mdNavStack = [];
  document.getElementById('viewer').innerHTML = `
    <div class="placeholder">
      <img src="https://cdn-icons-png.flaticon.com/512/2991/2991106.png"
           class="placeholder-icon" />
      <p>${message}</p>
    </div>`;
  document.querySelectorAll('.file').forEach(f => f.classList.remove('active'));
}

function closeFolder() {
  filesMap.clear();
  namePathMap.clear();
  fileTextCache.clear(); 
  mdNavStack = [];

  document.getElementById('fileList').innerHTML = '';
  showPlaceholder("Load a project folder to begin.");

  updateHeader('Flutter Code Viewer');
  history.replaceState({}, '', location.pathname); // clear hash
  console.clear();
  localStorage.clear();
  sessionStorage.clear();
}

// --- PATH HELPERS ---
function normalizeMarkdownPath(currentPath, href) {
  const parts = currentPath.split('/');
  parts.pop();
  const url = new URL(href, 'file://' + parts.join('/') + '/');
  return decodeURIComponent(url.pathname.slice(1));
}
// --- KEYBOARD SHORTCUTS ---
document.addEventListener('keydown', e => {
  // Global search
  if (e.ctrlKey && e.shiftKey && e.key.toLowerCase() === 'f') {
    e.preventDefault();
    showGlobalSearchModal();
    return;
  }

  // Local search
  if (e.ctrlKey && e.key.toLowerCase() === 'f') {
    e.preventDefault();
    document.getElementById('searchInput')?.focus();
    return;
  }

  // Go to file
  if (e.ctrlKey && e.key.toLowerCase() === 'p') {
    e.preventDefault();
    showGoToFileModal();
  }

  // Go to line
  if (e.ctrlKey && e.key.toLowerCase() === 'g') {
    e.preventDefault();
    showGoToLineModal();
  }

  // Escape from modals
  if (e.key === 'Escape') {
    hideGoToFileModal();
    hideGoToLineModal();
    hideGlobalSearchModal();
  }

  // Zoom In: Ctrl + = or Ctrl + +
  if (e.ctrlKey && (e.key === '=' || e.key === '+')) {
    e.preventDefault();
    increaseFont();
  }

  // Zoom Out: Ctrl + -
  if (e.ctrlKey && e.key === '-') {
    e.preventDefault();
    decreaseFont();
  }

  // Reset Font: Ctrl + 0
  if (e.ctrlKey && e.key === '0') {
    e.preventDefault();
    resetFont();
  }
});

// --- LOCAL SEARCH KEY HANDLING ---
document.getElementById('searchInput')?.addEventListener('keydown', e => {
  if (e.key === 'Enter') {
    e.preventDefault();
    highlightNextMatch();
  } else if (e.key === 'F3') {
    e.preventDefault();
    if (e.shiftKey) highlightPrevMatch();
    else highlightNextMatch();
  }
});


// --- GO TO FILE MODAL ---
function showGoToFileModal() {
  const m = document.getElementById('goToFileModal');
  m.style.display = 'flex';
  document.getElementById('goToFileInput').value = '';
  document.getElementById('fileSuggestions').innerHTML = '';
  document.getElementById('goToFileInput').focus();
}
function hideGoToFileModal() {
  document.getElementById('goToFileModal').style.display = 'none';
}
document.getElementById('goToFileInput')?.addEventListener('input', e => {
  const q = e.target.value.toLowerCase().trim();
  const cont = document.getElementById('fileSuggestions');
  cont.innerHTML = '';
  if (!q) return;
  [...filesMap.keys()]
    .filter(p => p.toLowerCase().includes(q))
    .slice(0, 10)
    .forEach(path => {
      const d = document.createElement('div');
      d.textContent = path;
      d.className = 'result-item';
      d.onclick = () => {
        hideGoToFileModal();
        loadFile(path, true);
      };
      cont.appendChild(d);
    });
});

// --- GO TO LINE MODAL ---
function showGoToLineModal() {
  const m = document.getElementById('goToLineModal');
  m.style.display = 'flex';
  const i = document.getElementById('goToLineInput');
  i.value = '';
  i.focus();
}
function hideGoToLineModal() {
  document.getElementById('goToLineModal').style.display = 'none';
}
document.getElementById('goToLineInput')?.addEventListener('keydown', e => {
  if (e.key === 'Enter') {
    const ln = parseInt(e.target.value, 10);
    if (!isNaN(ln) && ln > 0) {
      const vw = document.getElementById('viewer');
      const code = vw.querySelector('pre code');
      if (code) {
        code.innerHTML = code.innerHTML
          .split('\n')
          .map((l, i) => `<span data-line="${i+1}">${l}</span>`)
          .join('\n');
        const sp = code.querySelector(`span[data-line="${ln}"]`);
        if (sp) sp.scrollIntoView({ behavior: 'smooth', block: 'center' });
      }
    }
    hideGoToLineModal();
  }
});
function showGlobalSearchModal() {
  const modal = document.getElementById('globalSearchModal');
  modal.style.display = 'flex';
  document.getElementById('globalSearchInput').value = '';
  document.getElementById('globalSearchResults').innerHTML = '';
  document.getElementById('globalSearchInput').focus();
}
function hideGlobalSearchModal() {
  const modal = document.getElementById('globalSearchModal');
  modal.style.display = 'none';
}
async function performGlobalSearch(term) {
  const res = document.getElementById('globalSearchResults');
  res.innerHTML = '';
  if (!term) return;

  const frag = document.createDocumentFragment();
  let matchCount = 0;

  for (const [path, file] of filesMap.entries()) {
    const ext = path.split('.').pop().toLowerCase();
    if (!['dart', 'kt', 'java', 'yaml', 'yml', 'md', 'html', 'js', 'json', 'txt', 'xlsx'].includes(ext)) continue;

    const txt = fileTextCache.get(path);
    if (!txt) continue;

    txt.split('\n').forEach((line, i) => {
      if (line.toLowerCase().includes(term.toLowerCase())) {
        if (++matchCount > 100) return; // limit to 100 results for speed
        const d = document.createElement('div');
        d.className = 'result-item';
        d.innerHTML = `<strong>${path}</strong>: ${i + 1} → ${line.trim()}`;
        d.onclick = () => {
          hideGlobalSearchModal();
          loadFile(path, true, term);
        };
        frag.appendChild(d);
      }
    });
  }

  res.appendChild(frag.children.length ? frag : document.createTextNode('No matches found.'));
}
let debounceTimer;
document.getElementById('globalSearchInput')?.addEventListener('input', e => {
  clearTimeout(debounceTimer);
  const term = e.target.value.trim();
  debounceTimer = setTimeout(() => {
    if (term.length < 2) return;
    performGlobalSearch(term);
  }, 400);
});



// --- FOLDER PICKER & HISTORY NAVIGATION ---
window.addEventListener('popstate', e => {
  const s = e.state;
  if (s?.path) {
    loadFile(s.path, false, s.searchTerm);
    highlightSidebarItem(s.path);
    updateHeader(s.path);
  } else {
    showPlaceholder();
    updateHeader('Flutter Code Viewer');
  }
});
function pickFiles() {
  const inp = document.createElement('input');
  inp.type = 'file';
  inp.webkitdirectory = true;
  inp.multiple = true;
  inp.onchange = () => {
    const files = Array.from(inp.files);
    fileTextCache.clear();                // clear cache now that files are ready
    filesMap.clear();
    namePathMap.clear();
    mdNavStack = [];

    files.forEach(f => {
      const path = f.webkitRelativePath;
      filesMap.set(path, f);
      namePathMap.set(f, path);
      f.text().then(content => fileTextCache.set(path, content));
    });

    const tree = buildTree(files);
    const fl = document.getElementById('fileList');
    fl.innerHTML = '';
    fl.appendChild(renderTree(tree));
    showPlaceholder("Click a file to view its content.");
    history.replaceState({}, '', location.pathname);
    updateHeader('Flutter Code Viewer');
  };
  inp.click();
}


// --- BUILD & RENDER FILE TREE ---
function buildTree(files) {
  const t = {};
  files.forEach(f => {
    const parts = f.webkitRelativePath.split('/');
    let cur = t;
    parts.forEach((p, i) => {
      cur[p] = cur[p] || (i === parts.length - 1 ? f : {});
      cur = cur[p];
    });
  });
  return t;
}
function renderTree(tree) {
  const ul = document.createElement('ul');
  Object.keys(tree)
    .sort((a,b) => {
      const da = !(tree[a] instanceof File), db = !(tree[b] instanceof File);
      return da !== db ? (da ? -1 : 1) : a.localeCompare(b);
    })
    .forEach(name => {
      const itm = tree[name];
      const li = document.createElement('li');
      li.style.listStyle = 'none';
      if (itm instanceof File) {
        const ic = getIconClass(name, false);
        li.innerHTML = ic.startsWith('emoji-') ? `📄 ${name}` : `<i class="${ic}"></i>${name}`;
        li.className = 'file';
        li.onclick = () => {
          if (!li.classList.contains('active')) {
            document.querySelectorAll('.file').forEach(f=>f.classList.remove('active'));
            li.classList.add('active');
            loadFile(namePathMap.get(itm), true);
          }
        };
      } else {
        const ic = getIconClass(name, true);
        const dv = document.createElement('div');
        dv.innerHTML = ic.startsWith('emoji-') ? `📂 ${name}` : `<i class="${ic}"></i>${name}`;
        dv.style.cursor = 'pointer';
        dv.style.fontWeight = 'bold';
        const ch = renderTree(itm);
        ch.style.display = 'none';
        dv.onclick = () => {
          ch.style.display = ch.style.display==='none'?'block':'none';
        };
        li.appendChild(dv);
        li.appendChild(ch);
      }
      ul.appendChild(li);
    });
  return ul;
}

// --- MD TABLE OF CONTENTS ---
function generateTOC() {
  const toc = document.getElementById('toc');
  if (!toc) return;
  toc.innerHTML = '';
  document.querySelectorAll('.markdown-body h1, .markdown-body h2, .markdown-body h3')
    .forEach(h => {
      if (!h.id) {
        h.id = h.textContent.trim()
          .toLowerCase()
          .replace(/[^\w]+/g,'-');
      }
      const a = document.createElement('a');
      a.href = '#' + h.id;
      a.textContent = h.textContent;
      a.className = 'toc-link toc-' + h.tagName.toLowerCase();
      toc.appendChild(a);
    });
}

// --- LOAD & RENDER FILE ---
function loadFile(path, pushHist=true, hl='') {
  const file = filesMap.get(path);
  updateHeader(path);
  if (!file) return;
  const prev = history.state?.path;
  if (prev && pushHist && prev !== path) mdNavStack.push(prev);

  const ext = path.split('.').pop().toLowerCase();
  const vw = document.getElementById('viewer');

  function highlightMatches(term) {
  const blk = document.querySelector('#viewer pre code, #viewer .markdown-body');
  if (!blk) return;

  const regex = new RegExp(term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'gi');
  const walker = document.createTreeWalker(blk, NodeFilter.SHOW_TEXT);
  const nodes = [];

  let node;
  while ((node = walker.nextNode())) {
    if (regex.test(node.textContent)) {
      nodes.push(node);
    }
  }

  nodes.forEach(textNode => {
    const span = document.createElement('mark');
    span.className = 'search-highlight';
    span.textContent = textNode.textContent;
    textNode.parentNode.replaceChild(span, textNode);
  });
}
function scrollFirst() {
  const m = document.querySelector('mark.search-highlight');
  if (m) m.scrollIntoView({ behavior: 'smooth', block: 'center' });
}

  // Images
    if (ext !== 'md') previousMarkdownPath = null;
  if (['png','jpg','jpeg','gif','svg','webp'].includes(ext)) {
    vw.innerHTML = `<div style="text-align:center;">
      <img src="${URL.createObjectURL(file)}" style="max-width:100%;"/>
    </div>`;
    updateHeader(path);

  // XLSX
  } 
else if (ext === 'xlsx') {
  const reader = new FileReader();
  reader.onload = () => {
    const data = new Uint8Array(reader.result);
    const wb   = XLSX.read(data, { type: 'array' });

    // create tab bar
    const tabs = document.createElement('div');
    tabs.className = 'xlsx-tabs';
    wb.SheetNames.forEach((name, i) => {
      const btn = document.createElement('button');
      btn.textContent = name;
      btn.className = i === 0 ? 'active' : '';
      btn.onclick = () => {
        // highlight tab
        tabs.querySelectorAll('button').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        // render selected sheet
        renderSheet(name);
      };
      tabs.appendChild(btn);
    });

    // container for the table
    const tableWrap = document.createElement('div');
    tableWrap.className = 'xlsx-table-wrap';

    // function to (re)render a sheet
    function renderSheet(sheetName) {
      tableWrap.innerHTML = XLSX.utils.sheet_to_html(
        wb.Sheets[sheetName],
        { editable: false, id: 'sheet-' + sheetName }
      );
    }

    // put it all together
    vw.innerHTML = '';
    vw.appendChild(tabs);
    vw.appendChild(tableWrap);
    // show the first sheet by default
    renderSheet(wb.SheetNames[0]);
  };
  reader.readAsArrayBuffer(file);
}
 else if (ext === 'md') {
    const r = new FileReader();
    r.onload = () => {
      vw.innerHTML = `<div class="markdown-body">${
        new showdown.Converter({ tables:true, ghCompatibleHeaderId:true }).makeHtml(r.result)
      }</div>`;
      vw.scrollTop = 0;
      updateHeader(path);
      generateTOC();

      // MD→MD links & anchors
      vw.querySelectorAll('.markdown-body a').forEach(a => {
        const h = a.getAttribute('href');
        if (!h) return;
        const [fh, hash] = h.split('#');
        if (fh.endsWith('.md')) {
          a.onclick = e => {
            e.preventDefault();
            let tgt = normalizeMarkdownPath(path,fh);
            if (!filesMap.has(tgt)) {
              tgt = [...filesMap.keys()].find(p => p.endsWith(fh));
            }
            if (filesMap.has(tgt)) {
              loadFile(tgt,true);
              vw.scrollTop = 0;
            } else {
              alert(`File not found: ${fh}`);
            }
          };
        } else if (h.startsWith('#')) {
          a.onclick = e => {
            e.preventDefault();
            const anc = document.getElementById(h.slice(1));
            if (anc) anc.scrollIntoView({behavior:'smooth',block:'start'});
          };
        } else {
          a.setAttribute('target','_blank');
        }
      });

      // relative images
      vw.querySelectorAll('.markdown-body img').forEach(img => {
        const s = img.getAttribute('src');
        const k = [...filesMap.keys()].find(p => p.endsWith(s));
        if (k) {
          img.src = URL.createObjectURL(filesMap.get(k));
          img.style.maxWidth='100%';
          img.style.height='auto';
        }
      });

      if (hl) { highlightMatches(hl); scrollFirst(); }
    };
    r.readAsText(file);

  // Code / Text
  } else {
  const r = new FileReader();
  r.onload = () => {
    const lang = getLanguageFromExt(ext);
    const hi = Prism.highlight(
      r.result,
      Prism.languages[lang] || Prism.languages.plaintext,
      lang
    );

    vw.innerHTML = `<pre class="line-numbers language-${lang}"><code>${hi}</code></pre>`;
    Prism.highlightAll();

    // Wait for DOM update, then resize line numbers
    requestAnimationFrame(() => {
      Prism.plugins.lineNumbers?.resize();
    });

    updateHeader(path);

    if (hl) {
      setTimeout(() => {
        highlightMatches(hl);
        scrollFirst();
      }, 50); // ensure DOM elements are painted
    }
  };
  r.readAsText(file);
}

  if (pushHist) {
    history.pushState({ path, searchTerm: hl }, '', '#' + encodeURIComponent(path));
    highlightSidebarItem(path);
  }
}

// --- LOCAL SEARCH ---
let currentMatchIndex = 0;
let searchMatches = [];

function handleSearch() {
  const input = document.getElementById('searchInput');
  const term = input.value.trim();
  const vw = document.getElementById('viewer');
  const blk = vw.querySelector('pre code, .markdown-body');

  if (!blk || !term) return;

  // Clear existing highlights
  blk.innerHTML = blk.textContent;

  const regex = new RegExp(term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'gi');
  let html = blk.innerHTML;

  // Replace all matches with <mark>
  html = html.replace(regex, match => `<mark class="search-highlight">${match}</mark>`);
  blk.innerHTML = html;

  // Collect and scroll to first
  searchMatches = [...blk.querySelectorAll('mark.search-highlight')];
  currentMatchIndex = 0;
  highlightCurrentMatch();
}

function highlightCurrentMatch() {
  searchMatches.forEach(m => m.classList.remove('current-match'));
  if (searchMatches.length > 0) {
    const current = searchMatches[currentMatchIndex % searchMatches.length];
    current.classList.add('current-match');
    current.scrollIntoView({ behavior: 'smooth', block: 'center' });
  }
}

function highlightNextMatch() {
  if (searchMatches.length === 0) return;
  currentMatchIndex = (currentMatchIndex + 1) % searchMatches.length;
  highlightCurrentMatch();
}

function highlightPrevMatch() {
  if (searchMatches.length === 0) return;
  currentMatchIndex =
    (currentMatchIndex - 1 + searchMatches.length) % searchMatches.length;
  highlightCurrentMatch();
}


// --- SIDEBAR & HEADER UTILITIES ---
function highlightSidebarItem(path) {
  document.querySelectorAll('.file').forEach(f => f.classList.remove('active'));
  const m = [...document.querySelectorAll('.file')]
    .find(el => el.textContent.endsWith(path.split('/').pop()));
  if (m) m.classList.add('active');
}
function updateHeader(path) {
  const h = document.getElementById('header');
  h.innerHTML = '';
  // back-button for MD navigation
  if (mdNavStack.length) {
    const btn = document.createElement('button');
    btn.className = 'back-button';
    btn.textContent = '←';
    btn.onclick = () => {
      const prev = mdNavStack.pop();
      loadFile(prev, true);
    };
    h.appendChild(btn);
  }
  h.appendChild(document.createTextNode(' ' + path.split('/').pop()));
}
// --- Modal Auto-Close on Outside Click ---
['goToFileModal', 'goToLineModal', 'globalSearchModal'].forEach(id => {
  const modal = document.getElementById(id);
  if (!modal) return;
  modal.addEventListener('click', e => {
    if (e.target === modal) {
      modal.style.display = 'none';
    }
  });
});

// --- ICON & LANGUAGE MAPPING ---
function getIconClass(name, isFolder) {
  const l = name.toLowerCase();
  if (isFolder) {
    if (l==='android') return 'devicon-android-plain file-icon';
    if (l==='ios')     return 'devicon-apple-original file-icon';
    if (l==='lib')     return 'devicon-flutter-plain file-icon';
    return 'emoji-folder';
  }
  if (l.endsWith('.dart')) return 'devicon-dart-plain file-icon';
  if (l.endsWith('.md'))   return 'devicon-markdown-plain file-icon';
  if (l.endsWith('.html')) return 'devicon-html5-plain file-icon';
  if (l.endsWith('.xlsx')) return 'devicon-file-plain file-icon';
  return 'emoji-file';
}
function getLanguageFromExt(ext) {
  const m = {
    dart:'dart', kt:'kotlin', java:'java',
    yaml:'yaml', yml:'yaml',
    html:'markup', js:'javascript', json:'json',
    css:'css', md:'markdown'
  };
  return m[ext] || 'plaintext';
}
