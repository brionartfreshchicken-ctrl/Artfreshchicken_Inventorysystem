/* ===== js/inventory/17-modals.js =====
   Add/Edit Item modal and the Stock In/Out quantity modal.
   (Lines 2729-3226 of the original single-file build.) */

/* 12-modals.js — Add/Edit Item modal and the Stock In/Out quantity modal. */

/* Sensible units per category. "Other…" reveals a free-text box so nothing
   is locked out — a bulb of garlic or a sachet still works. */
const UNIT_CHOICES = {
  ingredient: ['kg','g','L','ml','pcs','pack','bottle','sachet','bulb'],
  snack:      ['pcs','pack','box'],
  drink:      ['pcs','bottle','can','glass','cup','L'],
  food:       ['serving','plate','bowl'],
};
function unitOptions(cat, current){
  const list = UNIT_CHOICES[cat] || UNIT_CHOICES.snack;
  const known = list.includes(current);
  return list.map(u =>
      `<option value="${u}" ${u===current?'selected':''}>${u}</option>`).join('')
    + `<option value="__other" ${current && !known ? 'selected' : ''}>Other…</option>`;
}

/* Shrinks and compresses a photo before it ever touches localStorage —
   a phone photo can be several MB, and this app's whole storage budget
   is ~5MB, so an unresized photo would blow through it in one add.
   Capped at 240px on the long edge, JPEG @ 70%, which keeps a typical
   product photo to a few KB. format defaults to 'jpeg'; pass 'png' for
   anything that has to stay pixel-exact — a QR code included, since
   JPEG's blocky compression can blur modules enough to break scanning. */
function resizeImageFile(file, maxDim, quality, format){
  format = format || 'jpeg';
  return new Promise((resolve, reject)=>{
    const reader = new FileReader();
    reader.onload = ()=>{
      const img = new Image();
      img.onload = ()=>{
        let w = img.width, h = img.height;
        if(w > maxDim || h > maxDim){
          if(w > h){ h = Math.round(h * maxDim / w); w = maxDim; }
          else { w = Math.round(w * maxDim / h); h = maxDim; }
        }
        const canvas = document.createElement('canvas');
        canvas.width = w; canvas.height = h;
        canvas.getContext('2d').drawImage(img, 0, 0, w, h);
        resolve(canvas.toDataURL(`image/${format}`, quality));
      };
      img.onerror = () => reject(new Error('Could not read that image'));
      img.src = reader.result;
    };
    reader.onerror = () => reject(new Error('Could not read that file'));
    reader.readAsDataURL(file);
  });
}

/* ---- Settings: upload/replace the business's real GCash QR code ----
   A static merchant QR doesn't change per sale, unlike the generated
   placeholder in the POS card — it's one image, set once, shown on
   every GCash checkout until someone replaces or removes it. */

function renderSettingsQr(){
  const img = document.getElementById('settings-qr-preview');
  const placeholder = document.getElementById('settings-qr-placeholder');
  const removeBtn = document.getElementById('settings-qr-remove');
  if(!img) return;
  if(state.gcashQrImage){
    img.src = state.gcashQrImage;
    img.style.display = '';
    placeholder.style.display = 'none';
    removeBtn.style.display = '';
  }else{
    img.style.display = 'none';
    placeholder.style.display = '';
    removeBtn.style.display = 'none';
  }
}

document.getElementById('settings-qr-file').addEventListener('change', async e=>{
  const file = e.target.files[0];
  if(!file) return;
  if(!file.type.startsWith('image/')){ toast('Please choose an image file', true); return; }
  try{
    state.gcashQrImage = await resizeImageFile(file, 400, 1, 'png');
    saveState();
    renderSettingsQr();
    toast('GCash QR code updated');
  }catch(err){
    toast(err.message || 'Could not process that image', true);
  }
});

document.getElementById('settings-qr-remove').addEventListener('click', ()=>{
  state.gcashQrImage = null;
  document.getElementById('settings-qr-file').value = '';
  saveState();
  renderSettingsQr();
  toast('GCash QR code removed — POS will show the placeholder code again');
});


function openItemModal(mode, presetCategory, item){
  const isEdit = mode==='edit';
  const cat = item ? item.category : presetCategory;
  const showCatSelect = presetCategory==='any';
  const isIngredient = cat==='ingredient';

  const body = `
    ${showCatSelect ? `
    <div class="field">
      <label>Category</label>
      <select id="f-cat">
        <option value="snack" ${cat==='snack'?'selected':''}>Snack</option>
        <option value="drink" ${cat==='drink'?'selected':''}>Drink</option>
        <option value="food" ${cat==='food'?'selected':''}>Food</option>
        <option value="ingredient" ${cat==='ingredient'?'selected':''}>Ingredient</option>
      </select>
    </div>` : ''}
    <div class="field-row">
      <div class="field">
        <label>Name</label>
        <input id="f-name" placeholder="e.g. Piattos" value="${item?escapeHtml(item.name):''}"/>
      </div>
      <div class="field" id="wrap-size" style="${isIngredient?'display:none;':''}">
        <label>Size <span class="muted">(optional)</span></label>
        <input id="f-size" list="size-suggestions" placeholder="Small / Medium / Large"
               value="${item?escapeHtml(item.size||''):''}"/>
        <datalist id="size-suggestions">
          <option value="Small"></option><option value="Medium"></option><option value="Large"></option>
          <option value="Regular"></option><option value="Malaki"></option><option value="Family"></option>
        </datalist>
      </div>
    </div>
    <div class="hint" id="size-hint" style="${isIngredient?'display:none;':''}margin-bottom:12px;">
      Each size is its own line with its own cost and price. Leave blank if it only comes one way.
    </div>
    <div class="field" id="wrap-image">
      <label>Photo <span class="muted">(optional)</span></label>
      <div style="display:flex;align-items:center;gap:12px;">
        <img id="f-image-preview" src="${item&&item.image?item.image:''}"
             style="width:64px;height:64px;border-radius:10px;object-fit:cover;border:1px solid var(--border);${item&&item.image?'':'display:none;'}background:var(--panel3);"/>
        <div style="flex:1;">
          <input type="file" id="f-image-file" accept="image/*"/>
          <div class="hint" style="margin-top:4px;">Shown on Products and Point of Sale. Resized automatically to keep things small.</div>
        </div>
        <button type="button" class="btn small ghost" id="f-image-remove" style="${item&&item.image?'':'display:none;'}">Remove</button>
      </div>
    </div>
    <div class="field-row">
      <div class="field"><label>SKU <span class="muted">(optional)</span></label>
        <input id="f-sku" placeholder="e.g. SNK-001" value="${item?escapeHtml(item.sku||''):''}"/></div>
      <div class="field"><label>Supplier <span class="muted">(optional)</span></label>
        <select id="f-supplier">
          <option value="">— None —</option>
          ${(state.suppliers||[]).map(s=>`<option value="${s.id}" ${item&&item.supplierId===s.id?'selected':''}>${escapeHtml(s.name)}</option>`).join('')}
        </select>
      </div>
    </div>
    <div class="field-row">
      <div class="field"><label>Stock</label><input id="f-stock" type="number" min="0" step="any" value="${item?item.stock:0}"/></div>
      <div class="field"><label>Unit</label>
        <select id="f-unit">${unitOptions(cat, item ? item.unit : (cat==='ingredient'?'kg':cat==='food'?'serving':'pcs'))}</select>
        <input id="f-unit-other" placeholder="type the unit" value="${item && !(UNIT_CHOICES[cat]||[]).includes(item.unit) ? escapeHtml(item.unit) : ''}"
               style="margin-top:8px;display:none;"/></div>
    </div>
    <div class="hint" style="margin:-4px 0 12px;">How many you have on hand right now. You can add more later with Stock In or a Purchase.</div>
    <div class="field-row">
      <div class="field"><label id="lbl-cost">${isIngredient?'Cost / Unit':'Cost (cost per unit)'}</label><input id="f-cost" type="number" min="0" step="any" placeholder="0.00" value="${item?item.cost:''}"/></div>
      <div class="field" id="wrap-selling" style="${isIngredient?'display:none;':''}"><label>Selling Price</label><input id="f-selling" type="number" min="0" step="any" placeholder="0.00" value="${item&&item.selling!=null?item.selling:''}"/></div>
    </div>
    <div class="hint" id="calc-preview"></div>
    <div class="field-row">
      <div class="field"><label>Minimum Stock</label>
        <input id="f-threshold" type="number" min="0" step="any" value="${item?item.threshold:5}"/></div>
      <div class="field"><label>Maximum Stock <span class="muted">(optional)</span></label>
        <input id="f-maxstock" type="number" min="0" step="any" placeholder="no limit" value="${item&&item.maxStock!=null?item.maxStock:''}"/></div>
    </div>
    <div class="hint" style="margin-top:-4px;">You'll get a Low Stock warning at or below Minimum. Maximum is just a reference ceiling for reordering.</div>
    <div class="field-row" style="margin-top:12px;">
      <div class="field"><label>Estimated Conversion Unit <span class="muted">(optional)</span></label>
        <input id="f-conv-unit" placeholder="e.g. pcs" value="${item&&item.conv?escapeHtml(item.conv.unit):''}"/></div>
      <div class="field"><label>Pieces per 1 ${escapeHtml(cat==='ingredient'?'unit':'unit')}</label>
        <input id="f-conv-qty" type="number" min="0" step="any" placeholder="e.g. 8" value="${item&&item.conv?item.conv.qty:''}"/></div>
    </div>
    <div class="hint" id="conv-hint" style="margin-top:-4px;">
      Optional — e.g. "1 kg ≈ 8 pcs". Always shown as an <strong>estimated</strong> conversion, never an exact count.
    </div>
  `;
  const foot = `
    <button class="btn ghost" id="f-cancel">Cancel</button>
    <button class="btn primary" id="f-save">${isEdit?'Save Changes':'Add Item'}</button>
  `;
  openModal(isEdit?`Edit ${catLabel(cat)}`:`Add ${catLabel(cat)}`, body, foot);

  if(showCatSelect){
    document.getElementById('f-cat').addEventListener('change', e=>{
      const v = e.target.value;
      const ing = v==='ingredient';
      document.getElementById('wrap-selling').style.display = ing ? 'none' : '';
      document.getElementById('wrap-size').style.display    = ing ? 'none' : '';
      document.getElementById('size-hint').style.display    = ing ? 'none' : '';
      document.getElementById('lbl-cost').textContent = ing ? 'Cost / Unit' : 'Cost (cost per unit)';
      const uSel = document.getElementById('f-unit');
      uSel.innerHTML = unitOptions(v, (UNIT_CHOICES[v]||[])[0]);
      toggleOtherUnit();
      updatePreview();
    });
  }

  /* "Other…" swaps in a free-text box */
  function toggleOtherUnit(){
    const sel   = document.getElementById('f-unit');
    const other = document.getElementById('f-unit-other');
    const on = sel.value === '__other';
    other.style.display = on ? 'block' : 'none';
    if(on) other.focus();
  }
  document.getElementById('f-unit').addEventListener('change', toggleOtherUnit);
  toggleOtherUnit();

  /* Live maths so you can see the totals before saving */
  function updatePreview(){
    const stock = parseFloat(document.getElementById('f-stock').value) || 0;
    const cost  = parseFloat(document.getElementById('f-cost').value)  || 0;
    const sellEl = document.getElementById('f-selling');
    const sell  = sellEl && sellEl.value!=='' ? parseFloat(sellEl.value) : null;
    const box = document.getElementById('calc-preview');

    let text = `<span class="calc-caption">🧮 Calculated automatically — nothing to type here</span>`;
    text += `Total cost: <b>${peso(stock*cost)}</b>`;
    if(sell!=null && !isNaN(sell)){
      text += ` &nbsp;·&nbsp; Profit per unit: <b>${peso(sell-cost)}</b>`;
      text += ` &nbsp;·&nbsp; Total profit: <b>${peso((sell-cost)*stock)}</b>`;
      if(sell < cost) text += ` <span style="color:var(--red)">— selling below cost!</span>`;
    }
    box.innerHTML = text;
  }
  ['f-stock','f-cost','f-selling'].forEach(id=>{
    const el = document.getElementById(id);
    if(el) el.addEventListener('input', updatePreview);
  });
  updatePreview();

  document.getElementById('f-cancel').addEventListener('click', closeModal);

  let currentImageData = item && item.image ? item.image : null;
  document.getElementById('f-image-file').addEventListener('change', async e=>{
    const file = e.target.files[0];
    if(!file) return;
    if(!file.type.startsWith('image/')){ toast('Please choose an image file', true); return; }
    try{
      currentImageData = await resizeImageFile(file, 240, 0.7);
      const preview = document.getElementById('f-image-preview');
      preview.src = currentImageData;
      preview.style.display = '';
      document.getElementById('f-image-remove').style.display = '';
    }catch(err){
      toast(err.message || 'Could not process that image', true);
    }
  });
  document.getElementById('f-image-remove').addEventListener('click', ()=>{
    currentImageData = null;
    document.getElementById('f-image-file').value = '';
    document.getElementById('f-image-preview').style.display = 'none';
    document.getElementById('f-image-remove').style.display = 'none';
  });

  document.getElementById('f-save').addEventListener('click', ()=>{
    const finalCat = showCatSelect ? document.getElementById('f-cat').value : cat;
    const name = document.getElementById('f-name').value.trim();
    const sizeEl = document.getElementById('f-size');
    const size = (finalCat==='ingredient' || !sizeEl) ? '' : sizeEl.value.trim();
    const stock = parseFloat(document.getElementById('f-stock').value);
    const unitSel = document.getElementById('f-unit').value;
    const unit = (unitSel === '__other'
      ? document.getElementById('f-unit-other').value.trim()
      : unitSel) || 'pcs';
    const cost = parseFloat(document.getElementById('f-cost').value);
    const sellingRaw = document.getElementById('f-selling') ? document.getElementById('f-selling').value : '';
    const selling = finalCat==='ingredient' ? null : (sellingRaw===''?null:parseFloat(sellingRaw));
    const threshold = parseFloat(document.getElementById('f-threshold').value) || 0;
    const sku = document.getElementById('f-sku').value.trim();
    const supplierRaw = document.getElementById('f-supplier').value;
    const supplierId = supplierRaw ? Number(supplierRaw) : null;
    const maxRaw = document.getElementById('f-maxstock').value;
    const maxStock = maxRaw==='' ? null : parseFloat(maxRaw);
    const convUnit = document.getElementById('f-conv-unit').value.trim();
    const convQtyRaw = document.getElementById('f-conv-qty').value;
    const conv = (convUnit && convQtyRaw!=='' && parseFloat(convQtyRaw)>0)
      ? { unit: convUnit, qty: parseFloat(convQtyRaw) } : null;

    if(!name){ toast('Please enter a name', true); return; }
    if(isNaN(stock) || stock<0){ toast('Please enter a valid stock quantity', true); return; }
    if(isNaN(cost) || cost<0){ toast('Please enter a valid cost', true); return; }
    if(maxStock != null && maxStock < threshold){
      toast('Maximum Stock should be greater than Minimum Stock', true); return;
    }

    // Saving is the same either way — only the duplicate warning differs
    const commit = ()=>{
      if(isEdit){
        Object.assign(item, {category:finalCat, name, size, stock, unit, cost, selling, threshold, sku, supplierId, maxStock, conv, image: currentImageData});
        toast('Item updated');
      }else{
        state.items.push({id:state.nextId++, category:finalCat, name, size, stock, unit, cost, selling, threshold, sku, supplierId, maxStock, conv, image: currentImageData});
        toast(size ? `${name} (${size}) added` : 'Item added');
      }
      saveState();
      renderAll();
      closeModal();
    };

    /* Same name and size already on file. That is usually a mistake, but it
       is legitimate when the same item is stocked at two different prices,
       so warn instead of blocking. */
    const clash = state.items.find(x =>
      x.name.toLowerCase() === name.toLowerCase() &&
      (x.size||'').toLowerCase() === size.toLowerCase() &&
      (!isEdit || x.id !== item.id));

    if(clash){
      const samePrice = clash.cost === cost && clash.selling === selling;
      closeModal();   // the item form must close before the question opens
      confirmAction('This already exists',
        `<div class="hint">You already have
           <strong style="color:var(--text)">${escapeHtml(displayName(clash))}</strong> —
           cost ${peso(clash.cost)}${clash.selling!=null?`, selling ${peso(clash.selling)}`:''},
           ${clash.stock} ${escapeHtml(clash.unit)} on hand.</div>
         <div class="hint" style="margin-top:10px;">
           You are adding another at cost ${peso(cost)}${selling!=null?`, selling ${peso(selling)}`:''}.
         </div>
         ${samePrice ? `
         <div class="hint" style="margin-top:10px;color:var(--yellow);">
           Both prices are identical, so this looks like a duplicate. If you just
           received stock at the same price, cancel and use <strong>Stock In</strong> instead.
         </div>` : `
         <div class="hint" style="margin-top:10px;color:var(--yellow);">
           Two lines with the same name and size look identical on the Sales screen.
           Put something in the <strong>Size</strong> field to tell them apart —
           for example "${escapeHtml(size||'Small')} (old stock)" or the supplier's name.
         </div>`}
         <div class="hint" style="margin-top:10px;">Add it as a separate line anyway?</div>`,
        'Add anyway', commit, false);
      return;
    }

    commit();
  });
}

/* ---------- Quantity (stock in/out) modal ---------- */

function openQtyModal(item, direction, allowPickItem, categoryForPick){
  const dirLabel = direction==='in' ? 'Stock In' : 'Stock Out';
  const body = `
    ${allowPickItem ? `
    <div class="field">
      <label>Item</label>
      <select id="f-item">
        ${state.items.filter(i=>i.category===categoryForPick).map(i=>`<option value="${i.id}" ${item&&item.id===i.id?'selected':''}>${escapeHtml(pickerLabel(i))} — ${i.stock} ${escapeHtml(i.unit)}</option>`).join('')}
      </select>
    </div>` : `<div class="hint">Item: <strong style="color:var(--text)">${escapeHtml(displayName(item))}</strong> — currently ${item.stock} ${escapeHtml(item.unit)}, cost ${peso(item.cost)}/unit</div>`}
    <div class="field">
      <label>Quantity to ${direction==='in'?'add':'remove'}</label>
      <input id="f-qty" type="number" min="0" step="any" value="1"/>
    </div>
    <div class="field">
      <label>Reason</label>
      <select id="f-reason">
        ${direction==='in' ? `
          <option value="purchase">Purchase / delivery — expense</option>
          <option value="produced">Cooked / produced</option>
          <option value="correct_in">Stock correction</option>
        ` : `
          <option value="sold">Sold — revenue</option>
          <option value="used">Used in cooking</option>
          <option value="waste">Spoiled / waste</option>
          <option value="correct_out">Stock correction</option>
        `}
      </select>
    </div>
    <div class="hint" id="qty-preview" style="margin-top:4px;"></div>
  `;
  const foot = `<button class="btn ghost" id="f-cancel">Cancel</button><button class="btn primary" id="f-save">Confirm ${dirLabel}</button>`;
  openModal(dirLabel, body, foot);

  document.getElementById('f-cancel').addEventListener('click', closeModal);

  /* Show what this movement is worth before it is confirmed */
  function currentTarget(){
    return allowPickItem ? byId(Number(document.getElementById('f-item').value)) : item;
  }
  function previewQty(){
    const t = currentTarget();
    const qty = parseFloat(document.getElementById('f-qty').value) || 0;
    const reason = document.getElementById('f-reason').value;
    const box = document.getElementById('qty-preview');
    if(!t || qty <= 0){ box.innerHTML = ''; return; }

    const caption = `<span class="calc-caption">🧮 Calculated automatically — nothing to type here</span>`;
    if(reason === 'sold' && t.selling != null){
      const benta = qty*t.selling, puh = qty*t.cost;
      box.innerHTML = `${caption}Revenue <b>${peso(benta)}</b> &nbsp;·&nbsp; cost ${peso(puh)} &nbsp;·&nbsp; profit <b style="color:var(--green)">${peso(benta-puh)}</b>`;
    }else if(reason === 'purchase'){
      box.innerHTML = `${caption}Expenses: <b>${peso(qty*t.cost)}</b>`;
    }else if(reason === 'waste'){
      box.innerHTML = `${caption}Loss sa sayang: <b style="color:var(--red)">${peso(qty*t.cost)}</b>`;
    }else{
      box.innerHTML = `${caption}Stock value: <b>${peso(qty*t.cost)}</b> — not counted as revenue`;
    }
  }
  ['f-qty','f-reason','f-item'].forEach(id=>{
    const el = document.getElementById(id);
    if(el) el.addEventListener('input', previewQty);
    if(el) el.addEventListener('change', previewQty);
  });
  previewQty();

  document.getElementById('f-save').addEventListener('click', ()=>{
    const target = currentTarget();
    const qty = parseFloat(document.getElementById('f-qty').value);
    const reason = document.getElementById('f-reason').value;
    if(!target){ toast('Please select an item', true); return; }
    if(isNaN(qty) || qty<=0){ toast('Enter a quantity greater than 0', true); return; }
    if(direction==='out' && qty>target.stock){ toast('Not enough stock to remove that much', true); return; }
    if(reason==='sold' && target.selling==null){
      toast('This item has no selling price, so it cannot be sold', true); return;
    }
    target.stock = direction==='in' ? target.stock+qty : Math.max(0, target.stock-qty);

    // This item's stock might be one that Menu Plan owns (synced from
    // servings − served — see syncActivePlanFoodsToPOS). If so, adjusting
    // stock here without also telling the Menu Plan meant the very next
    // sync pass silently overwrote this change back to whatever
    // servings − served already was — the adjustment "worked" (toast and
    // all) but never actually stuck, and the movement it just logged
    // could then never be voided ("would drop below zero") because the
    // stock had already reverted under it. Adjusting Target Servings by
    // the same amount keeps servings − served equal to the new stock, so
    // the next sync agrees with what just happened instead of undoing it.
    if(target.sourcePlanId != null && target.sourceFoodId != null){
      const linkedPlan = cosPlans().find(p => p.id === target.sourcePlanId);
      const linkedFood = linkedPlan && (linkedPlan.foods||[]).find(f => f.id === target.sourceFoodId);
      if(linkedFood){
        const delta = direction==='in' ? qty : -qty;
        linkedFood.servings = Math.max(0, (Number(linkedFood.servings)||0) + delta);
      }
    }

    logActivity(target, direction, qty, reason);
    saveState();
    renderAll();
    closeModal();
    toast(reason==='sold'
      ? `Sold ${qty} ${target.unit} — revenue ${peso(qty*target.selling)}`
      : `${dirLabel} recorded for ${target.name}`);
  });
}

/* The browser's confirm() is blocked inside sandboxed frames, so every
   yes/no question goes through the app's own modal instead. */

function confirmDelete(item){
  // Sales records survive product deletion by default, because the money was
  // real. But when you are clearing out test data you want them gone too.
  const records = state.activity.filter(a => a.itemId === item.id);
  const sales   = records.filter(a => (a.reason==='sold' && !a.voided));
  const worth   = sales.reduce((t,a)=>t+lineBenta(a), 0);

  // This item might be one Menu Plan generates (see syncActivePlanFoodsToPOS)
  // from a food that still has a name/servings/price. Deleting only the
  // item here, without also telling Menu Plan, meant the very next sync
  // pass saw that food still looking active and recreated a brand new
  // item for it — the delete "worked" for a moment, then the product came
  // right back the next time anything re-rendered. Finding and removing
  // the source food too, the same way Menu Plan's own "Remove food" does,
  // is what makes the deletion actually stick.
  let linkedPlan = null, linkedFood = null;
  if(item.sourcePlanId != null && item.sourceFoodId != null){
    linkedPlan = cosPlans().find(p => p.id === item.sourcePlanId);
    linkedFood = linkedPlan && (linkedPlan.foods||[]).find(f => f.id === item.sourceFoodId);
  }

  const body = `
    <div class="hint">Delete <strong style="color:var(--text)">${escapeHtml(displayName(item))}</strong> from your inventory?</div>
    ${linkedFood ? `
      <div class="hint" style="margin-top:12px;color:var(--yellow);line-height:1.6;">
        This product comes from <strong style="color:var(--text)">${escapeHtml(linkedFood.name||'a food')}</strong>
        on your Menu Plan — deleting it here also removes that food from the plan, or it would just
        reappear the next time anything refreshes.
      </div>
    ` : ''}
    ${records.length ? `
      <div class="hint" style="margin-top:12px;">
        This item appears in <strong style="color:var(--text)">${records.length}</strong>
        log record${records.length===1?'':'s'}${sales.length ? `, including ${sales.length}
        sale${sales.length===1?'':'s'} worth ${peso(worth)}` : ''}.
      </div>
      <label style="display:flex;gap:9px;align-items:flex-start;margin-top:14px;cursor:pointer;">
        <input type="checkbox" id="del-history" style="width:auto;margin-top:3px;flex-shrink:0;"/>
        <span class="hint">Also delete those records</span>
      </label>
      <div class="hint" style="margin-top:10px;color:var(--yellow);line-height:1.6;">
        Ticked: the item disappears from reports and Excel downloads completely,
        and your revenue and profit for those days go down. Use this for test data.<br><br>
        Unticked: past sales stay on record, which is what you want for real
        trading — you did sell those, and the money came in.
      </div>
    ` : `<div class="hint" style="margin-top:10px;">Nothing in the log refers to this item.</div>`}
  `;
  const foot = `<button class="btn ghost" id="f-cancel">Cancel</button><button class="btn danger" id="f-del">Delete</button>`;
  openModal('Delete Item', body, foot);
  document.getElementById('f-cancel').addEventListener('click', closeModal);
  document.getElementById('f-del').addEventListener('click', ()=>{
    const box = document.getElementById('del-history');
    const alsoHistory = box && box.checked;

    if(linkedPlan && linkedFood){
      returnDeduction(linkedFood);   // put its ingredients back, same as removing it on Menu Plan
      linkedPlan.foods = (linkedPlan.foods||[]).filter(f => f.id !== linkedFood.id);
    }

    state.items = state.items.filter(i=>i.id!==item.id);
    if(alsoHistory) state.activity = state.activity.filter(a => a.itemId !== item.id);

    saveState();
    renderAll();
    closeModal();
    toast(alsoHistory
      ? `Item and ${records.length} record${records.length===1?'':'s'} deleted`
      : 'Item deleted, sales history kept');
  });
}

/* ============================= PAGE BUTTONS ============================= */

document.getElementById('btnAddInventory').addEventListener('click', ()=>openItemModal('add','any'));

document.getElementById('btnProduceBatch').addEventListener('click', ()=>openQtyModal(state.items.find(i=>i.category==='food'), 'in', true, 'food'));

/* ---------- Settings ---------- */

/* ============================= COST OF SALES =============================
   One plan per day. Foods sit inside it, each with its own ingredients.
   Each food carries its own ingredient list, and every ingredient cost comes
   Ingredient costs are tracked per food.

   This is planning — what you INTEND to cook. Actually cooking a batch and
   moving real stock is the "Produce batch" button on the Food page. */
