/* ===== js/core/01-config.js =====
   Constants: page titles, movement reasons, security questions, limits, nav access lists, dashboard/state helpers.
   (Lines 1-85 of the original single-file build.) */


(function(){
  const real = document.getElementById.bind(document);
  const spare = document.createElement('div');
  document.getElementById = id => real(id) || spare;
})();

/* 01-config.js — Constants: page titles, movement reasons, security questions, limits
   Cafeteria Inventory System.
   These files share one global scope and run in the order listed in
   index.html, so keep the numbering. */

/* ============================= STATE ============================= */

let state = null;

let filters = {
  'inventory-search':'', 'inventory-cat':'all', 'inventory-status':'all',
  'suppliers-search':'',
  'sales-search':'', 'sales-cat':'all',
  'recipes-search':'',
  'expenses-search':'', 'expenses-cat':'all'
};

const ACTIVITY_CAP  = 20000;

const ACTIVITY_WARN = 15000;

/* What a movement means. Only 'sold' counts as benta. */

const REASONS = {
  purchase: {label:'Purchase / delivery', dir:'in'},
  produced: {label:'Cooked / produced',   dir:'in'},
  correct_in:{label:'Stock correction',   dir:'in'},
  sold:     {label:'Sold',                dir:'out'},
  waste:    {label:'Spoiled / waste',     dir:'out'},
  used:     {label:'Used in cooking',     dir:'out'},
  correct_out:{label:'Stock correction',  dir:'out'},
  adjust:   {label:'Unclassified',        dir:'both'}
};

const reasonLabel = r => (REASONS[r] || REASONS.adjust).label;

/* ============================= NAV ============================= */

const pageMeta = {
  dashboard:  {ic:'🖥', title:'Dashboard',        sub:'Overview of all stock'},
  inventory:  {ic:'📦', title:'Products',         sub:'All products across every category — food, snacks, drinks and ingredients'},
  stockmovements: {ic:'🔄', title:'Stock Movements', sub:'Every stock change — purchases, sales, waste, production and corrections'},
  purchases:  {ic:'🧾', title:'Purchases',        sub:'What you bought, from whom, and what it cost'},
  suppliers:  {ic:'🚚', title:'Suppliers',        sub:'Who you buy from, and their purchase history'},
  sales:      {ic:'🛒', title:'Point of Sale',    sub:'Record what goes over the counter'},
  history:    {ic:'📅', title:'Sales History',    sub:'Daily, weekly and monthly totals'},
  cos:        {ic:'🍽', title:'Menu Plan',        sub:'Plan each day: foods, ingredients, servings and cost per serving'},
  recipes:    {ic:'📖', title:'Recipes',          sub:'Reusable recipes — ingredients, cost per serving, selling price and margin'},
  production: {ic:'🏭', title:'Production',       sub:'Cook a recipe, deduct ingredients, and stock the finished item'},
  expenses:   {ic:'🧯', title:'Operating Expenses', sub:'Every expense the business logs, plus Staff Directory and LPG usage'},
  reports:    {ic:'📊', title:'Reports',          sub:'Profit & Loss, best sellers and waste'},
  settings:   {ic:'⚙',  title:'Settings',         sub:'Accounts and access'},
};

/* ============================= ACCOUNTS & LOGIN =============================
   Who is signed in right now. Kept in memory only, so closing or
   refreshing the page signs you out — the way a shared counter
   terminal should behave. */

const SECURITY_QUESTIONS = [
  "What was the name of your first pet?",
  "What is your mother's maiden name?",
  "What city were you born in?",
  "What was the name of your elementary school?",
  "What is your favourite food?",
  "What was your first job?"
];

const CUSTOM_Q = '__custom__';

// "  Manila " and "manila" should both work

const isGmail = v => /^[^\s@]+@gmail\.com$/i.test(String(v||'').trim());

/* Held in memory only, never written to storage, so it cannot be read back
   out of the saved data. */

