/* ===== js/menu-plan/14-recipes.js =====
   Recipes: reusable ingredient templates, cost/serving, selling price and margin.
   (Lines 2226-2446 of the original single-file build.) */

/* ============================= RECIPES ============================= */
/* Spec item 16. A reusable template — separate from a day's Menu Plan,
   which stays exactly as it was for day-to-day planning. Cost/Serving,
   Profit/Serving and Margin follow the spec's formulas exactly:
     Total Recipe Cost = sum of ingredient costs
     Cost per Serving  = Total Recipe Cost / Servings
     Profit per Serving = Selling Price − Cost per Serving
     Profit Margin      = Profit / Selling Price × 100
   ingredientByName() (defined further down, in the Menu Plan code) is
   reused as-is — a recipe's ingredients reference the same items an
   ingredient's stock lives on. */

let recipeDraftLines = [];   // [{name, qtyNum, qtyUnit}] — only while the modal is open

function recipeTotals(r){
  const totalCost = (r.lines||[]).reduce((t,l)=>{
    const item = ingredientByName(l.name);
    return t + (item ? (Number(l.qtyNum)||0)*item.cost : 0);
  }, 0);
  const perServing = r.servings>0 ? totalCost/r.servings : 0;
  const profitPerServing = r.price!=null ? r.price - perServing : null;
  const margin = (r.price!=null && r.price>0) ? (profitPerServing/r.price*100) : null;
  return {totalCost, perServing, profitPerServing, margin};
}

function renderRecipes(){
  const body = document.getElementById('tbl-recipes');
  if(!body) return;
  const term = (filters['recipes-search']||'').toLowerCase();
  const list = (state.recipes||[]).filter(r=>!term || r.name.toLowerCase().includes(term))
    .sort((a,b)=>a.name.localeCompare(b.name));

  if(!list.length){
    body.innerHTML = `<tr class="empty-row"><td colspan="9">No recipes yet.</td></tr>`;
    return;
  }
  body.innerHTML = list.map(r=>{
    const t = recipeTotals(r);
    const linked = r.linkedItemId ? byId(r.linkedItemId) : null;
    return `<tr>
      <td>${escapeHtml(r.name)}</td>
      <td><span class="cat-tag">${catLabel(r.category)}</span></td>
      <td>${r.servings}</td>
      <td class="num">${peso(t.perServing)}</td>
      <td class="num">${r.price!=null?peso(r.price):'—'}</td>
      <td class="num" style="${t.profitPerServing<0?'color:var(--red)':''}">${t.profitPerServing!=null?peso(t.profitPerServing):'—'}</td>
      <td class="num">${t.margin!=null?t.margin.toFixed(1)+'%':'—'}</td>
      <td class="muted">${linked?escapeHtml(displayName(linked)):'—'}</td>
      <td>
        <button class="btn small" data-edit-recipe="${r.id}">Edit</button>
        <button class="btn small danger" data-del-recipe="${r.id}">Delete</button>
      </td>
    </tr>`;
  }).join('');
}

function renderRecipeLines(){
  const tbody = document.getElementById('rc-lines');
  if(!tbody) return;
  tbody.innerHTML = recipeDraftLines.length ? recipeDraftLines.map((l,idx)=>{
    const item = ingredientByName(l.name);
    return `<tr>
      <td>${escapeHtml(l.name)}</td>
      <td>${l.qtyNum} ${escapeHtml(l.qtyUnit)}</td>
      <td class="num">${item?peso((Number(l.qtyNum)||0)*item.cost):'—'}</td>
      <td class="num"><button class="btn small danger" data-rm-rline="${idx}">×</button></td>
    </tr>`;
  }).join('') : `<tr class="empty-row"><td colspan="4">No ingredients added yet.</td></tr>`;
  updateRecipePreview();
}

function updateRecipePreview(){
  const servingsEl = document.getElementById('rc-servings');
  const priceEl = document.getElementById('rc-price');
  if(!servingsEl) return;
  const servings = parseFloat(servingsEl.value) || 0;
  const priceRaw = priceEl.value;
  const price = priceRaw==='' ? null : parseFloat(priceRaw);
  const totalCost = recipeDraftLines.reduce((t,l)=>{
    const item = ingredientByName(l.name);
    return t + (item ? (Number(l.qtyNum)||0)*item.cost : 0);
  }, 0);
  const perServing = servings>0 ? totalCost/servings : 0;
  const profitPerServing = price!=null ? price - perServing : null;
  const margin = (price!=null && price>0) ? (profitPerServing/price*100) : null;
  const box = document.getElementById('rc-preview');
  if(box) box.innerHTML = `<span class="calc-caption">🧮 Calculated automatically</span>
    Total Recipe Cost: <b>${peso(totalCost)}</b> &nbsp;·&nbsp; Cost/Serving: <b>${peso(perServing)}</b>
    &nbsp;·&nbsp; Profit/Serving: <b style="${profitPerServing<0?'color:var(--red)':''}">${profitPerServing!=null?peso(profitPerServing):'—'}</b>
    &nbsp;·&nbsp; Margin: <b>${margin!=null?margin.toFixed(1)+'%':'—'}</b>`;
}

function openRecipeModal(mode, recipe){
  const isEdit = mode==='edit';
  recipeDraftLines = recipe ? (recipe.lines||[]).map(l=>({...l})) : [];
  const ingredientItems = state.items.filter(i=>i.category==='ingredient');
  const foodItems = state.items.filter(i=>i.category==='food'||i.category==='snack'||i.category==='drink');

  const body = `
    <div class="field-row">
      <div class="field"><label>Recipe Name</label>
        <input id="rc-name" placeholder="e.g. Chicken Meal" value="${recipe?escapeHtml(recipe.name):''}"/></div>
      <div class="field"><label>Category</label>
        <select id="rc-category">
          <option value="food" ${!recipe||recipe.category==='food'?'selected':''}>Food</option>
          <option value="snack" ${recipe&&recipe.category==='snack'?'selected':''}>Snack</option>
          <option value="drink" ${recipe&&recipe.category==='drink'?'selected':''}>Drink</option>
        </select></div>
    </div>
    <div class="field-row">
      <div class="field"><label>Servings per Batch</label>
        <input id="rc-servings" type="number" min="0" step="any" value="${recipe?recipe.servings:1}"/></div>
      <div class="field"><label>Selling Price / Serving</label>
        <input id="rc-price" type="number" min="0" step="any" placeholder="0.00" value="${recipe&&recipe.price!=null?recipe.price:''}"/></div>
    </div>
    <div class="field"><label>Linked Sellable Item <span class="muted">(optional — Production will stock this item)</span></label>
      <select id="rc-linked">
        <option value="">— None, prep only —</option>
        ${foodItems.map(i=>`<option value="${i.id}" ${recipe&&recipe.linkedItemId===i.id?'selected':''}>${escapeHtml(displayName(i))}</option>`).join('')}
      </select>
    </div>

    <div class="hint" style="margin:14px 0 8px;font-weight:600;">Ingredients</div>
    ${ingredientItems.length ? `
    <div class="field-row">
      <div class="field" style="flex:2;"><label>Ingredient</label>
        <select id="rc-ing">
          ${ingredientItems.map(i=>`<option value="${escapeHtml(i.name)}" data-unit="${escapeHtml(i.unit)}">${escapeHtml(i.name)} (${escapeHtml(i.unit)})</option>`).join('')}
        </select></div>
      <div class="field"><label>Quantity</label>
        <input id="rc-ing-qty" type="number" min="0" step="any" value="1"/></div>
    </div>
    <button class="btn small" id="btnAddRecipeLine">+ Add Ingredient</button>
    ` : `<div class="hint" style="color:var(--yellow);">No ingredient items yet — add some on the Products page first.</div>`}
    <table style="margin-top:10px;"><thead><tr>
      <th>Ingredient</th><th>Qty</th><th class="num">Cost</th><th></th>
    </tr></thead><tbody id="rc-lines"></tbody></table>
    <div class="hint" id="rc-preview" style="margin-top:10px;"></div>
  `;
  const foot = `<button class="btn ghost" id="f-cancel">Cancel</button>
    <button class="btn primary" id="f-save">${isEdit?'Save Changes':'Add Recipe'}</button>`;
  openModal(isEdit?'Edit Recipe':'Add Recipe', body, foot);

  renderRecipeLines();
  ['rc-servings','rc-price'].forEach(id=>document.getElementById(id).addEventListener('input', updateRecipePreview));

  const addLineBtn = document.getElementById('btnAddRecipeLine');
  if(addLineBtn) addLineBtn.addEventListener('click', ()=>{
    const sel = document.getElementById('rc-ing');
    const opt = sel.selectedOptions[0];
    const qty = parseFloat(document.getElementById('rc-ing-qty').value);
    if(isNaN(qty) || qty<=0){ toast('Enter a quantity greater than 0', true); return; }
    recipeDraftLines.push({ name: sel.value, qtyNum: qty, qtyUnit: opt.dataset.unit });
    document.getElementById('rc-ing-qty').value = 1;
    renderRecipeLines();
  });

  document.getElementById('rc-lines').addEventListener('click', e=>{
    const btn = e.target.closest('[data-rm-rline]');
    if(!btn) return;
    recipeDraftLines.splice(Number(btn.dataset.rmRline),1);
    renderRecipeLines();
  });

  document.getElementById('f-cancel').addEventListener('click', closeModal);
  document.getElementById('f-save').addEventListener('click', async ()=>{
    const name = document.getElementById('rc-name').value.trim();
    const category = document.getElementById('rc-category').value;
    const servings = parseFloat(document.getElementById('rc-servings').value);
    const priceRaw = document.getElementById('rc-price').value;
    const price = priceRaw==='' ? null : parseFloat(priceRaw);
    const linkedRaw = document.getElementById('rc-linked').value;
    const linkedItemId = linkedRaw ? Number(linkedRaw) : null;

    if(!name){ toast('Please enter a recipe name', true); return; }
    if(isNaN(servings) || servings<=0){ toast('Enter servings greater than 0', true); return; }
    if(!recipeDraftLines.length){ toast('Add at least one ingredient', true); return; }

    const data = { name, category, servings, price, linkedItemId, lines: recipeDraftLines.map(l=>({...l})) };
    try{
      if(isEdit){
        const updated = await dbUpdateRecipe(recipe.id, data);
        Object.assign(recipe, updated);
        toast('Recipe updated');
      }else{
        const created = await dbInsertRecipe(data);
        state.recipes.push(created);
        toast('Recipe added');
      }
    }catch(err){
      toast(err.message || 'Could not save that recipe', true);
      return;
    }
    saveState();
    renderAll();
    closeModal();
  });
}

function confirmDeleteRecipe(recipe){
  openModal('Delete Recipe',
    `<div class="hint">Delete <strong style="color:var(--text)">${escapeHtml(recipe.name)}</strong>?
       Past Production records are not affected — they keep their own copy of what was used.</div>`,
    `<button class="btn ghost" id="f-cancel">Cancel</button><button class="btn danger" id="f-del">Delete</button>`);
  document.getElementById('f-cancel').addEventListener('click', closeModal);
  document.getElementById('f-del').addEventListener('click', async ()=>{
    try{
      await dbDeleteRecipe(recipe.id);
    }catch(err){
      return toast(err.message || 'Could not delete that recipe', true);
    }
    state.recipes = state.recipes.filter(r=>r.id!==recipe.id);
    saveState(); renderAll(); closeModal();
    toast('Recipe deleted');
  });
}

document.getElementById('btnAddRecipe').addEventListener('click', ()=>openRecipeModal('add'));

document.getElementById('tbl-recipes').addEventListener('click', e=>{
  const editBtn = e.target.closest('[data-edit-recipe]');
  if(editBtn){
    const r = state.recipes.find(x=>x.id===Number(editBtn.dataset.editRecipe));
    if(r) openRecipeModal('edit', r);
    return;
  }
  const delBtn = e.target.closest('[data-del-recipe]');
  if(delBtn){
    const r = state.recipes.find(x=>x.id===Number(delBtn.dataset.delRecipe));
    if(r) confirmDeleteRecipe(r);
  }
});
