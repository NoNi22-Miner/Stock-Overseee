# Item recognition and Delivery Order scanning — design (for approval)

Status: **proposal, not built yet.** Agreed so far with the Team Leader on 7 Nov 2026.

## 1. Item structure (the Recognition Table)

Every item is built from parts picked from lists. The app writes the name, so the same item is always
spelled the same way.

| Part | Example | Required | List |
|---|---|:-:|---|
| **Category** | PLAT BESI | ✅ | per team; each category has its **own size pattern** |
| **Grade** | A / B / C | – | one list for all categories |
| **Label** (standard / jurisdiction) | SS400 | – | per team |
| **Size** | 16mm × 4' × 8' | ✅ | fields follow the category's pattern |
| **Brand** | VM* | – | per team |
| **Unit** | Lembar / Batang / Pcs / Kg | ✅ | Kg allows decimals; Lembar, Batang and Pcs are whole numbers |

- **Type** = Category + Grade, e.g. "PLAT BESI A".
- Name built automatically: **PLAT BESI A · SS400 · 16mm × 4' × 8' · VM\***
- **Size patterns** (examples, set per category by the Team Leader):
  - Plat Besi: Tebal (mm) × Lebar (ft) × Panjang (ft)
  - Pipa: Diameter (inch) × Tebal (mm) × Panjang (m)
  - As: Diameter (mm) × Panjang (m)
- **Other spellings (aliases)** on every list entry, because suppliers write things differently:
  - "PLAT BESI" = "PLAT HITAM" = "PL" = "PLATE"
  - "SS400" = "SS 400" = "SS-400"
  - "4'" = "4 ft" = "1219"
  - "VM\*" = "VM"
- No duplicates: the same Category + Grade + Label + Size + Brand can exist only once.
- Existing items keep working. They show as **"not structured"** until someone edits them into parts.

## 2. Adding items

- **In the app:** Category → Grade → Label → size boxes (from the category's pattern) → Brand → Unit
  → Save.
- **Excel import:** download a template, fill in one row per item (Category, Grade, Label, size 1,
  size 2, size 3, Brand, Unit, min stock), then import it.
  - The app shows a check list first: new items, duplicates, and unknown categories / labels / brands.
    The Team Leader confirms before anything is saved.
  - Unknown list entries can be created during the import.

## 3. Scanning a Delivery Order page (main flow)

The camera reads **paper**: a Delivery Order (Surat Jalan) or similar page, not the steel itself. One
page usually lists several items with quantities, so one photo becomes a whole list.

1. **Scan → Stock In / Out / Transfer → Scan document.** Take one photo of the page. Long or
   multi-page orders: add more pages.
2. **Read:** the text is read on the phone (offline) and split into **rows**, using the position of
   each line on the page.
3. **Understand each row:** the app looks for
   - the **quantity + unit**, e.g. "20 lbr", "5 btg", "150 kg"
   - the item parts: Category / Grade / Label / Size / Brand, using the lists and their aliases
4. **Review list:** one line per row of the page.

   ```
   ✓ PLAT BESI A · SS400 · 16mm×4'×8' · VM*      20 Lembar   [change]
   ? Pick one:  PLAT BESI · SS400 · 12mm×4'×8' · VM*   or   … · KS     10 Lembar
   ✗ "PIPA HTM 2 inch"  — no match: [search] [skip]
   ```

   - **✓ sure match:** the item is filled in. Check the qty.
   - **? several possible items:** a short list of similar items. Tap the right one, then enter or check
     the qty.
   - **✗ no match:** search or pick it by tapping (see 4), or skip the row.
   - Header lines (company name, address, date, signatures) are ignored automatically.
5. **Confirm all at once.** Every line becomes a movement (In / Out / Transfer), with the order number
   as the note. Offline it goes to the sync queue like any scan.
6. **Learning:** when you pick an item for a row that didn't match, the app can **remember that
   supplier spelling** as an alias, so it matches by itself next time.

## 4. Picking an item without scanning

Narrow with taps: **Category → Grade → Label → Size → Brand**, about 5 taps to any item with no typing.
The same filter chips appear under every "Pick one" list.

## 5. Technical notes

- The current text reader gives text blocks without positions. Splitting a page into rows needs
  line positions, so the plan is to switch to Google ML Kit through
  `@infinitered/react-native-mlkit-text-recognition`. It also includes the model in the app, so it
  works offline from the first use. A test build is needed to confirm it builds with this Expo
  version.
- Matching runs on the phone against the saved item list, so it also works offline.
- Database changes: `grades`, `labels`, `brands` tables; `categories.size_pattern`; `aliases` on every
  list; products get `grade_id`, `label_id`, `brand_id`, `size` (values), `unit`
  (lembar / batang / pcs / kg). All per team, with the same security rules as today.

## 6. Needed from the Team Leader

- **A photo of a real Delivery Order page** (cover prices or customer names if needed). It shows how
  rows, quantities and units are written, so the row reading can be tuned to it.
- The **categories and their size patterns** you use (e.g. Plat Besi, Pipa, As, Siku, …).
