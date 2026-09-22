/* ===== js/utils/05-ui.js =====
   Generic UI helpers: toast notifications, opening/closing modals, confirm dialogs.
   (Lines 511-568 of the original single-file build.) */

/* 05-ui.js — Generic UI helpers: toast notifications, opening/closing modals, confirm dialogs. */

function toast(msg, kind){
  // kind: true or 'err' -> red error text; 'success' -> green confirmation; anything else -> neutral
  const isErr = kind === true || kind === 'err';
  const isSuccess = kind === 'success';
  const wrap = document.getElementById('toast');
  const el = document.createElement('div');
  el.className = 'toast-item' + (isErr ? ' err' : '') + (isSuccess ? ' success' : '');
  el.textContent = msg;
  wrap.appendChild(el);
  wrap.classList.add('show');           // this was missing — toasts were rendering but never slid into view
  setTimeout(()=>{
    el.remove();
    if(!wrap.children.length) wrap.classList.remove('show');
  }, 3200);
}

/* Every stock movement is logged in full, because the reports are built
   entirely from this list. cost and selling are snapshotted at the moment
   it happened — if you change a price later, past reports stay correct. */

const overlay = document.getElementById('overlay');

const modalTitle = document.getElementById('modalTitle');

const modalBody = document.getElementById('modalBody');

const modalFoot = document.getElementById('modalFoot');

function openModal(title, bodyHtml, footHtml){
  modalTitle.textContent = title;
  modalBody.innerHTML = bodyHtml;
  modalFoot.innerHTML = footHtml;
  overlay.classList.add('active');
}

function closeModal(){ overlay.classList.remove('active'); }

/* "I paid ₱X for Y [unit], what's the price for one [unit]?" — turns
   that manual division into a fill-in-the-blanks tool. Opens as its own
   modal, so only call this from somewhere that ISN'T already showing
   the shared modal (there's one overlay/#modal in the whole app — see
   the Add/Edit Product form for the inline version used there instead,
   since that form IS the modal already). onApply(perUnit) receives the
   computed price per 1 unit; nothing is applied until "Use This Price". */
function openPriceCalculator(unitLabel, onApply){
  const label = unitLabel || 'unit';
  openModal('Calculate Price per Unit', `
    <div class="hint" style="margin-bottom:12px;">Enter what you paid and how much you got — this works out the price for one ${escapeHtml(label)}.</div>
    <div class="field-row">
      <div class="field"><label>Amount Paid (₱)</label>
        <input id="pc-paid" type="number" min="0" step="any" placeholder="0.00"/></div>
      <div class="field"><label>Quantity Received (${escapeHtml(label)})</label>
        <input id="pc-qty" type="number" min="0" step="any" placeholder="0"/></div>
    </div>
    <div class="hint" id="pc-result" style="margin-top:6px;"></div>
  `, `<button class="btn ghost" id="pc-cancel">Cancel</button>
      <button class="btn primary" id="pc-use">Use This Price</button>`);

  function compute(){
    const paid = parseFloat(document.getElementById('pc-paid').value);
    const qty = parseFloat(document.getElementById('pc-qty').value);
    const box = document.getElementById('pc-result');
    if(isNaN(paid) || isNaN(qty) || qty<=0){ box.innerHTML = ''; return null; }
    const perUnit = paid / qty;
    box.innerHTML = `<span class="calc-caption">🧮 ${peso(paid)} ÷ ${qty} ${escapeHtml(label)}</span>Price per ${escapeHtml(label)}: <b>${peso(perUnit)}</b>`;
    return perUnit;
  }
  ['pc-paid','pc-qty'].forEach(id => document.getElementById(id).addEventListener('input', compute));
  document.getElementById('pc-cancel').addEventListener('click', closeModal);
  document.getElementById('pc-use').addEventListener('click', ()=>{
    const perUnit = compute();
    if(perUnit === null){ toast('Enter a paid amount and quantity first', true); return; }
    onApply(Math.round(perUnit * 10000) / 10000);   // keep sub-peso precision for cheap-per-gram items
    closeModal();
  });
  document.getElementById('pc-paid').focus();
}

document.getElementById('modalClose').addEventListener('click', closeModal);

overlay.addEventListener('click', e=>{ if(e.target===overlay) closeModal(); });

document.addEventListener('keydown', e=>{ if(e.key==='Escape') closeModal(); });

/* ---------- Add / Edit item modal ---------- */

function confirmAction(title, bodyHtml, confirmLabel, onConfirm, danger){
  openModal(title, bodyHtml,
    `<button class="btn ghost" id="ca-cancel">Cancel</button>
     <button class="btn ${danger===false?'primary':'danger'}" id="ca-ok">${confirmLabel}</button>`);
  document.getElementById('ca-cancel').addEventListener('click', closeModal);
  document.getElementById('ca-ok').addEventListener('click', ()=>{
    closeModal();          // close first so the next screen isn't covered
    onConfirm();
  });
}

/* ---------- Saving a generated file (Excel/CSV exports, backups) ----------
   The plain downloaded/opened version of this app has no window.claude at
   all, so this falls straight through to the classic browser download —
   completely unchanged from before. Inside the in-chat preview, where a
   classic <a download> silently does nothing (the sandboxed frame has no
   real place to put the file), this uses the "downloads" capability
   instead, which shows the viewer a real save confirmation. Every export
   function in the app calls this one place instead of saving directly. */
async function saveGeneratedFile(filename, blob){
  const hasClaudeRuntime = typeof window !== 'undefined'
    && window.claude && typeof window.claude.use === 'function';

  if(hasClaudeRuntime){
    let downloads = null;
    try{ downloads = await window.claude.use('downloads'); }catch(e){ downloads = null; }
    if(downloads){
      try{
        await downloads.save({filename, data: blob});
        return true;
      }catch(err){
        // "declined" = the viewer said no — their choice, not an error to report.
        if(err && err.code !== 'declined'){
          toast('Could not save the file' + (err && err.message ? ': ' + err.message : ''), true);
        }
        return false;   // either way, don't also try a raw browser download here
      }
    }
    // downloads resolved null — capability not declared/granted in this view — fall through
  }

  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  a.click();
  URL.revokeObjectURL(a.href);
  return true;
}
