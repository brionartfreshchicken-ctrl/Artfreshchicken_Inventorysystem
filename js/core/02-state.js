/* ===== js/core/02-state.js =====
   Default state shape, the sample data a fresh install ships with, and migrate() for upgrading older saves.
   (Lines 86-156 of the original single-file build.) */

/* 02-state.js — Default state shape, the sample data a fresh install ships with, and migrate() for upgrading older saves to whatever the app currently expects. */

/* The starter plan a brand-new install ships with. Also reused by
   migrate() below to backfill accounts that existed before Menu
   Planning did, so History isn't left empty forever for them. */
function sampleCosPlan(){
  return {
    id: 1, name: 'Sample Menu', date: isoDate(new Date()), created: Date.now(),
    foods: [{
      id: 1, name: 'Chicken Adobo', servings: 10, served: 8, price: 60,
      lines: [
        {id:1, name:'Chicken',          qtyNum:2, qtyUnit:'kg', qty:'2 kg',            priceNum:125, priceMode:'unit', unit:'125 / kg',    total:250},
        {id:2, name:'Onion',            qtyNum:1, qtyUnit:'pcs', qty:'1 pc',            priceNum:10, priceMode:'unit', unit:'10 / pc',     total:10},
        {id:3, name:'Garlic',           qtyNum:1, qtyUnit:'bulb', qty:'1 bulb',          priceNum:15, priceMode:'unit', unit:'15 / bulb',   total:15},
        {id:4, name:'Vinegar',          qtyNum:1, qtyUnit:'bottle', qty:'1 bottle (250ml)',priceNum:20, priceMode:'unit', unit:'20 / bottle', total:20},
        {id:5, name:'Soy Sauce (Toyo)', qtyNum:1, qtyUnit:'bottle', qty:'1 bottle (250ml)',priceNum:20, priceMode:'unit', unit:'20 / bottle', total:20},
        {id:6, name:'Bay Leaf',         qtyNum:3, qtyUnit:'pcs', qty:'3 pcs',           priceNum:5, priceMode:'total', unit:'5 / pack',    total:5,  manual:false},
        {id:7, name:'Black Pepper',     qtyNum:1, qtyUnit:'sachet', qty:'1 sachet',        priceNum:5, priceMode:'unit', unit:'5 / sachet',  total:5},
        {id:8, name:'Cooking Oil',      qtyNum:100, qtyUnit:'ml', qty:'100 ml',          priceNum:15, priceMode:'total', unit:'15 / 100ml',  total:15, manual:false}
      ]
    },{
      id: 2, name: 'Pancit', servings: 15, served: 15, price: 20,
      lines: [
        {id:9,  name:'Pancit Canton', qtyNum:1, qtyUnit:'kg', qty:'1 kg',   priceNum:85, priceMode:'unit', unit:'85 / kg',  total:85},
        {id:10, name:'Carrots',       qtyNum:0.5, qtyUnit:'kg', qty:'0.5 kg', priceNum:70, priceMode:'unit', unit:'70 / kg',  total:35},
        {id:11, name:'Cabbage',       qtyNum:0.5, qtyUnit:'kg', qty:'0.5 kg', priceNum:50, priceMode:'unit', unit:'50 / kg',  total:25}
      ]
    }]
  };
}

function defaultState(){
  return {
    // These three were missing entirely on a brand-new install — every
    // piece of code that reads them (Setup, Sign Up, Inventory, POS...)
    // assumes they exist, so a truly fresh load crashed immediately.
    items: [],
    users: [],
    activity: [],
    staffList: [],
    lpgLogs: [],
    suppliers: [],
    purchases: [],
    docSeq: {},        // per-day document counters, e.g. {'PO-20260915': 3}
    nextStaffId: 1,
    nextLpgId: 1,
    nextId: 100,   // new items start here, above the seeded ids
    nextUserId: 1, // account ids
    nextActivityId: 1000,
    nextSupplierId: 1,
    nextPurchaseId: 1,
    sales: [],
    nextSaleId: 1,
    expenses: [],
    nextExpenseId: 1,
    gcashQrImage: null,
    recipes: [],
    nextRecipeId: 1,
    productions: [],
    nextProductionId: 1,
    retentionDays: 0,   // 0 = keep every record
    lastPurge: null, // movement-log ids, above the seeded ones
    nextCosId: 1, nextCosLineId: 1, nextCosPlanId: 1,
    cosActiveId: null,
    /* A plan is a day. Foods live inside it, each with its own ingredients.
       A brand-new install starts with none — same as every other list in
       this app (no seeded products, suppliers, recipes...) — so nothing
       shows up that nobody actually typed in. Create your first plan with
       "+ New Plan" on the Menu Plan page. */
    cosPlans: [],
  };
}

/* ============================= STORAGE ============================= */
