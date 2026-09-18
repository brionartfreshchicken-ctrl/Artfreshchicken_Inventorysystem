# FoodTrack — Split Build, 10 Functional Folders

HTML, CSS, and JavaScript fully separated. JavaScript is split into 22
files (numbered 01–22 in exact load order) across exactly 10 folders,
grouped by what each one actually does rather than by file count.

## Folder structure

```
index.html
css/
  styles.css
icons/
js/
  core/          01-config, 02-state, 03-storage, 22-boot
                 — constants, default state, load/save, app startup
  utils/         04-format, 05-ui
                 — currency/date formatting, toasts, modals
  auth/          06-accounts, 07-login, 08-recovery, 09-otp
                 — accounts, sign in/up, password recovery, one-time codes
  nav/           10-nav-dashboard
                 — page routing, role access, Dashboard
  inventory/     11-inventory, 17-modals
                 — Products CRUD, stock movements, Add/Edit modals
  procurement/   12-suppliers, 13-purchases
                 — Suppliers directory, Purchase orders
  menu-plan/     14-recipes, 15-production, 21-cos
                 — Recipes, Production, Menu Plan / food costing
  expenses/      16-operating-expenses
                 — Operating Expenses
  pos/           18-pos
                 — Point of Sale: cart, checkout, cash & GCash
  reports/       19-history-retention-staff-reports, 20-reports
                 — Sales History, Retention, Staff/LPG, Reports, P&L
```

Load order is set by `index.html`'s `<script>` tags, top to bottom — that
order is what matters, not which folder a file happens to live in.

## Verified
- Byte-for-byte identical code to the working single-file version —
  confirmed by diffing the reassembled script against it before and
  after this reorganization
- Full functional pass: setup, adding a product, every major page,
  staff sign-up/login, a complete GCash sale with correct stock
  deduction — zero errors

## One file that isn't single-purpose
`js/reports/19-history-retention-staff-reports.js` covers more than one
topic (Sales History, Retention, Staff/LPG, and Profit & Loss reporting
all ended up together as those features were built one at a time and
landed physically close together). Splitting it further would mean
moving code to new positions rather than drawing a line between
existing sections — happy to take a dedicated pass at that specifically
if you want it split further.

## How to run it
Keep the folder structure intact (`index.html` next to `css/`, `js/`,
and `icons/`) and open `index.html` in a browser.
