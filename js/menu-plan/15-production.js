/* ===== js/menu-plan/15-production.js =====
   Production: cooking a recipe, deducting scaled ingredients, crediting a linked sellable item.
   (Lines 2447-2581 of the original single-file build.) */

/* ============================= PRODUCTION ============================= */
/* Spec item 17. Cooking a recipe: scales its ingredient list by
   (quantity to produce / recipe servings), deducts the scaled amount
   from each ingredient, and — if the recipe has a linked sellable item —
   credits that item's stock and updates its cost to what this batch
   actually cost per serving, the same way a Purchase updates cost. */

function renderProductionRecipeOptions(){
  const sel = document.getElementById('pr-recipe');
  if(!sel) return;
  const keep = sel.value;
  sel.innerHTML = (state.recipes||[])
    .slice().sort((a,b)=>a.name.localeCompare(b.name))
    .map(r=>`<option value="${r.id}">${escapeHtml(r.name)} — ${r.servings} servings/batch</option>`).join('');
  if(keep) sel.value = keep;
}

function computeProductionPreview(){
  const recipeId = Number(document.getElementById('pr-recipe').value);
  const recipe = (state.recipes||[]).find(r=>r.id===recipeId);
  const qty = parseFloat(document.getElementById('pr-qty').value) || 0;
  const box = document.getElementById('pr-preview');
  if(!recipe || qty<=0){ if(box) box.innerHTML=''; return null; }

  const multiplier = recipe.servings>0 ? qty/recipe.servings : 0;
  const lines = (recipe.lines||[]).map(l=>{
    const item = ingredientByName(l.name);
    const need = (Number(l.qtyNum)||0) * multiplier;
    return { item, name: l.name, unit: l.qtyUnit, need };
  });
  const totalCost = lines.reduce((t,l)=>t + (l.item ? l.need*l.item.cost : 0), 0);
  const short = lines.filter(l=>!l.item || l.need > l.item.stock);

  if(box){
    box.innerHTML = `<span class="calc-caption">🧮 Calculated automatically — estimated from the recipe</span>` +
      lines.map(l=>`${escapeHtml(l.name)}: ${round2(l.need)} ${escapeHtml(l.unit)}` +
        (!l.item ? ` <span style="color:var(--red)">— no matching ingredient item</span>`
          : (l.need>l.item.stock ? ` <span style="color:var(--red)">— only ${round2(l.item.stock)} on hand</span>` : ''))
      ).join('<br>') +
      `<br>Total Ingredient Cost: <b>${peso(totalCost)}</b>` +
      (recipe.linkedItemId ? `<br>New Cost / Serving (updates ${escapeHtml(displayName(byId(recipe.linkedItemId))||'')}): <b>${peso(qty>0?totalCost/qty:0)}</b>` : '<br><span class="muted">Prep only — no sellable item will be stocked.</span>');
  }
  return {recipe, qty, multiplier, lines, totalCost, short};
}

function renderProductions(){
  renderProductionRecipeOptions();
  computeProductionPreview();

  const list = (state.productions||[]).slice().sort((a,b)=>b.date-a.date);
  const countEl = document.getElementById('pr-histcount');
  if(countEl) countEl.textContent = list.length ? `${list.length} production${list.length===1?'':'s'}` : '';

  const body = document.getElementById('tbl-productions');
  if(!body) return;
  body.innerHTML = list.length ? list.map(p=>`<tr>
      <td>${escapeHtml(p.prodNumber)}</td>
      <td class="muted">${new Date(p.date).toLocaleDateString()}</td>
      <td>${escapeHtml(p.recipeName)}</td>
      <td class="num">${round2(p.qtyProduced)}</td>
      <td class="num strong">${peso(p.totalCost)}</td>
      <td class="muted">${escapeHtml(p.producedBy||'—')}</td>
      <td><button class="btn small" data-view-prod="${p.id}">View</button></td>
    </tr>`).join('')
    : `<tr class="empty-row"><td colspan="7">No production recorded yet.</td></tr>`;
}

['pr-recipe','pr-qty'].forEach(id=>
  document.getElementById(id).addEventListener('input', computeProductionPreview));
document.getElementById('pr-recipe').addEventListener('change', computeProductionPreview);

document.getElementById('btnCompleteProduction').addEventListener('click', ()=>{
  const preview = computeProductionPreview();
  if(!preview || !preview.recipe){ toast('Select a recipe and a quantity first', true); return; }
  if(preview.qty <= 0){ toast('Enter a quantity greater than 0', true); return; }
  if(!preview.lines.length){ toast('This recipe has no ingredients to deduct', true); return; }
  if(preview.short.length){ toast('Not enough ingredients on hand for this quantity', true); return; }

  const producedBy = document.getElementById('pr-producedby').value.trim() || (currentUser?currentUser.name:'—');
  const prodNumber = nextDocNumber('PROD');

  preview.lines.forEach(l=>{
    l.item.stock = Math.round((l.item.stock - l.need) * 1000) / 1000;
    logActivity(l.item, 'out', l.need, 'used', prodNumber);
  });

  if(preview.recipe.linkedItemId){
    const linked = byId(preview.recipe.linkedItemId);
    if(linked){
      linked.stock += preview.qty;
      linked.cost = preview.qty>0 ? preview.totalCost/preview.qty : linked.cost;
      logActivity(linked, 'in', preview.qty, 'produced', prodNumber);
    }
  }

  state.productions.push({
    id: state.nextProductionId++,
    prodNumber,
    date: Date.now(),
    recipeId: preview.recipe.id,
    recipeName: preview.recipe.name,
    qtyProduced: preview.qty,
    ingredientsConsumed: preview.lines.map(l=>({name:l.name, qty:round2(l.need), unit:l.unit})),
    totalCost: preview.totalCost,
    producedBy
  });

  document.getElementById('pr-qty').value = 1;
  saveState();
  renderAll();
  toast(`${prodNumber} recorded — ${peso(preview.totalCost)} in ingredients used`);
});

document.getElementById('tbl-productions').addEventListener('click', e=>{
  const btn = e.target.closest('[data-view-prod]');
  if(!btn) return;
  const p = state.productions.find(x=>x.id===Number(btn.dataset.viewProd));
  if(!p) return;
  const body = `
    <div class="hint">Recipe: <strong style="color:var(--text)">${escapeHtml(p.recipeName)}</strong></div>
    <div class="hint">Date: ${new Date(p.date).toLocaleString()}</div>
    <div class="hint">Produced By: ${escapeHtml(p.producedBy||'—')}</div>
    <div class="hint">Quantity Produced: ${round2(p.qtyProduced)}</div>
    <table style="margin-top:12px;"><thead><tr>
      <th>Ingredient</th><th class="num">Qty Used</th>
    </tr></thead><tbody>
      ${p.ingredientsConsumed.map(l=>`<tr><td>${escapeHtml(l.name)}</td><td class="num">${l.qty} ${escapeHtml(l.unit)}</td></tr>`).join('')}
    </tbody><tfoot><tr class="total-row">
      <td>TOTAL COST</td><td class="num strong">${peso(p.totalCost)}</td>
    </tr></tfoot></table>
  `;
  openModal(p.prodNumber, body, `<button class="btn ghost" id="f-cancel">Close</button>`);
  document.getElementById('f-cancel').addEventListener('click', closeModal);
});
