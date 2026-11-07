# Item recognition — final concept

Status: **agreed concept, not built yet** (7 Nov 2026). Replaces the earlier full-page DO idea.
Section 6 was checked against the real item list (`Item_Name.xlsx`, 398 names): every name splits
into these parts.

## 1. Item structure (the Recognition Table)

Every item is built from parts picked from lists. The app writes the name, so the same item is always
spelled the same way.

| Part | Example | Required | List |
|---|---|:-:|---|
| **Category** | BESI BETON ULIR, PLAT BESI | ✅ | per team; each category has its **own size pattern** and default unit |
| **Grade** | A / B / C | – | one list for all categories |
| **Labels** (standard / spec) | U-280 · SS400 · SCH40 + SNI | – | per team; **an item can have up to 3** |
| **Size** | 16mm × 12m · 100 × 50 × 20 × 2.3mm × 6m | ✅* | **up to 5 boxes**, following the category's size pattern |
| **Brand** | AS-T, KP, VM | – | per team |
| **Mark** | (\*) , NS | – | meaning to be confirmed (section 7) |
| **Unit** | Lembar / Batang / Pcs / Kg / … | ✅ | per team list; each unit says if decimals are allowed (Kg yes) |

\* A category can have no size pattern (e.g. BARANG BAN BEKAS); its items have no size.

- **Type** = Category + Grade, e.g. "CNP BESI A".
- The name is built automatically, in this order:
  - **Category Grade · Labels · Size · Brand Mark**
  - e.g. **BESI BETON ULIR · U-280 · 16mm × 12m · AS-T**
  - e.g. **PIPA BESI · A106/A53/API 5L SCH40 S · 2" × 6m · RRC**
  - e.g. **CNP BESI A · 125 × 50 × 20 × 2.3mm × 6m**
- **Size patterns** are set per category by the Team Leader / Oversee (full list in section 6). A size box:
  - has a name and a usual unit (mm, cm, m, inch ", feet ', kg, L, BWG, °)
  - can be **optional** — PIPA HITAM is written both as `1"X6M` and as `1" (30.5MM)X1.6MMX6M`
  - can hold a **range** — `600-635CM`
  - can hold a **second reading in brackets** — `1 1/2" (44.5MM)`
  - takes the unit that is written, so `1.47MMX675MMX800MM` and `1.8MMX4'X8'` both fit PLAT BESI
- **Other spellings (aliases)** on every list entry, because paperwork spells things differently:
  - "U-280" = "U280" = "U 280" = "U -280"
  - "U-35" = "U35", "HK-T" = "HKT", "AS-T" = "AST"
  - "SW-308L" = "SS SW308L", "SS400" = "SS 400"
  - Grade "A" = "STD (A)" = "STD(A)"
  - Category "AS STAINLESS" = "AS" (paper: `AS SS201 …`), "PIPA STAINLESS" = "PIPA" (paper: `PIPA SS304 …`)
- **Locations get aliases too.** "PNK IPS" / "PNK1PS" = **WRH**, ready for the DO file import later.
- No duplicates: the same Category + Grade + Labels + Size + Brand + Mark can exist only once.
- **Weight (KG) is not tracked** in this version (possible next update: weight per unit).
- Existing items keep working. They show as **"not structured"** until someone edits them into parts.

## 2. Setting up and adding items

- **Recognition Table screen** (Products → Recognition Table, Team Leader / Oversee only):
  - tabs **Categories** (size pattern + default unit), **Grades**, **Labels**, **Brands**, **Units**
  - every entry has a list of other spellings
- **Add item:** Category → Grade → Labels → size boxes → Brand → Unit → Save.
- **Excel import of items:**
  - Download the template: Category · Grade · Label 1–3 · Size 1–5 · Brand · Mark · Unit · Min stock.
  - Or import **plain names** (one name per row, like `Item_Name.xlsx`): the app splits each name
    into parts with the same reader used for scanning.
  - A check list comes first: new items, duplicates, names it could not split, and unknown categories /
    labels / brands (these can be created during the import). Nothing is saved until the Team Leader
    confirms.

## 3. Scanning an item name (partial scan)

The camera reads **only the item name**, for example the description line on a Delivery Order. It does
not read the whole page or the quantity.

1. **Scan** → choose In / Out / Transfer and the location as today.
2. **Scan with camera → Words.** Put the **item name line inside the box**, e.g.
   `BESI BETON ULIR 16MMX12M AS-T U-280`, and tap **Read words**. Only the text **inside the box** is
   read, so the address, signatures and other lines on the page are ignored.
3. The app finds each part:

   | Read | Understood as |
   |---|---|
   | BESI BETON ULIR | Category |
   | 16MMX12M | Size 16 mm × 12 m |
   | AS-T | Brand |
   | U-280 | Label |

   Parts can be in any order (`BESI BETON 10MMX12M AS-T U-280` and `PLAT BESI SS400 10MMX4'X8' KP`
   both work). The longest category wins, so `BESI BETON ULIR` is not read as `BESI BETON`.
4. **List of possible items**, best first, each showing which parts matched:

   ```
   BESI BETON ULIR · U-280 · 16mm×12m · AS-T     ✓Category ✓Size ✓Label ✓Brand
   BESI BETON ULIR · U-420 · 16mm×12m · AS-T     ✓Category ✓Size ✓Brand
   BESI BETON ULIR · U-280 · 13mm×12m · AS-T     ✓Category ✓Label ✓Brand   (size differs)
   ```

   - **Sizes must agree.** A different size is never shown as a sure match.
   - Parts that weren't read (e.g. covered by a signature) don't count against an item.
5. **Tap the right item → qty pad** (shows the unit, e.g. "Batang") → enter the qty → confirm.
   Works offline like every scan.
6. **Learns the spelling:** after you pick an item from the list, the app remembers that exact text for
   that item. The next time the same text is scanned, the item is selected straight away.
7. **Narrow by tapping:** under the list, chips for Category / Grade / Label / Size / Brand. With no
   scan at all you can also tap your way to any item: Category → Grade → Label → Size → Brand.
8. **Typing** a name in the scan box uses the same matching.

## 4. Later (not in this version)

- **DO file import** from your DO system (Excel / PDF), using the warehouse column via location aliases.
  Waiting for a sample file.
- Weight per unit / KG totals.
- Basket mode, QR labels, quick picks (from the brainstorm).

## 5. Technical notes

- **Reading only the box:** the photo is cropped to the box area (plus a small margin) before the text
  is read on the phone (offline). The current text reader stays.
- **Splitting a name** (scan, typing and Excel import all use the same reader), in this order:
  1. category (longest spelling first)
  2. marks, labels, grades, brands — whole words only, longest spelling first, so `LB 52U` beats
     `LB 52` and the brand `L` is never taken from `5L`
  3. the size from what is left: numbers joined by `X` or spaces, with units, fractions (`1 1/2"`),
     ranges (`600-635CM`) and brackets (`(44.5MM)`)
  4. anything left over is shown as "not understood"
  - A prototype of this reader split all 398 names in `Item_Name.xlsx` with nothing left over.
- **Matching** runs on the phone against the saved item list, so it also works offline.
  - Each part is matched through its list and aliases, with the OCR fixes used today (O↔0, I↔1, S↔5).
  - Sizes are compared number by number.
- **Database:**
  - new tables `grades`, `labels`, `brands`, `units`, `product_aliases` (learned spellings)
  - `categories.size_pattern` (box names, units, optional flag) and `categories.default_unit`
  - `aliases` on every list (and on locations)
  - products get `grade_id`, `label_ids` (up to 3, in order), `brand_id`, `mark`, `size` (values per box)
    and `unit`
  - all per team, with the same security rules as today

## 6. Your Recognition Table (from Item_Name.xlsx)

Starting lists made from the 398 names. They can all be changed in the Recognition Table later.

### Categories (27)

| Category | Size pattern | Default unit | Items |
|---|---|---|--:|
| AS BESI | Diameter (mm / inch) × Panjang (m) | Batang | 30 |
| AS BESI SEGI-4 | Sisi × Sisi (mm) × Panjang (m) | Batang | 1 |
| AS STAINLESS (paper: AS) | Diameter (mm / inch) × Panjang (m / cm) | Batang | 14 |
| BARANG BAN BEKAS | no size | Pcs | 1 |
| BESI BETON | Diameter (mm) × Panjang (m) | Batang | 15 |
| BESI BETON ULIR | Diameter (mm) × Panjang (m) | Batang | 13 |
| CAT BESI DAN KAYU | Isi (L / kg) | ? | 1 |
| CAT MENI | Isi (L / kg) | ? | 1 |
| CAT TEMBOK | Isi (L / kg) | ? | 2 |
| CNP BESI | Tinggi × Lebar × Bibir × Tebal (mm) × Panjang (m) | Batang | 12 |
| ELBOW BESI | Diameter (inch) × Sudut (°) | Pcs | 4 |
| FLANGE | Diameter (inch) | Pcs | 1 |
| H BEAM BESI | H × B × t1 × t2 (mm) × Panjang (m) | Batang | 3 |
| KAWAT BENDRAT | BWG × Berat (kg) | ? | 3 |
| KAWAT LAS | Diameter (mm) | ? | 15 |
| KAWAT LAS KUNINGAN | Diameter (mm) | ? | 3 |
| PAKU | Panjang (inch) × Berat (kg) | ? | 1 |
| PIPA BESI | Diameter (inch) × Panjang (m) | Batang | 27 |
| PIPA GALVANIS | Diameter (inch) × Panjang (m) | Batang | 8 |
| PIPA HITAM | Diameter (inch) (OD mm, optional) × Tebal (mm, optional) × Panjang (m) | Batang | 41 |
| PIPA KOTAK GALVANIS | Sisi × Sisi × Tebal (mm) × Panjang (m) | Batang | 2 |
| PIPA KOTAK HITAM | Sisi × Sisi × Tebal (mm) × Panjang (m) | Batang | 1 |
| PIPA STAINLESS (paper: PIPA) | Diameter (inch) × Panjang (m) | Batang | 8 |
| PLAT ALUMINIUM | Tebal (mm) × Lebar (m) × Panjang (m) | Lembar | 11 |
| PLAT ALUMINIUM BORDES | Tebal (mm) × Lebar (m) × Panjang (m) | Lembar | 3 |
| PLAT BESI | Tebal (mm) × Lebar (ft) × Panjang (ft) | Lembar | 164 |
| PLAT BESI BORDES | Tebal (mm) × Lebar (ft) × Panjang (ft) | Lembar | 13 |

### Labels (40)

- **Steel / material:** S45C, ST41, SS201, SS304, SS304/L, SS316L, SS400, SPHC, A36, BJPC, BJPLC, BJPS,
  BJPSS400, 1100 (aluminium)
- **Rebar:** U-280, U-420, U-35
- **Pipe:** A106/A53/API 5L, SCH10, SCH20, SCH40, SCH80, MED, LGH, SNI, S (seamless?), W (welded?), SGP
- **Welding rod:** LB 52, LB 52U, RB 26, RR-213, SW-308L, BKI ABS
- **Other:** BKI, 10K, PRESS (?)
- **Paint colours:** BLACK MATT, PRIMER RED, LILY WHITE A O3501, SUPER WHITE O3005

### Brands (47)

- **Plat / H beam:** KP, KS, MB, VM, ET, GRP, GDS, TM, GYS, RSI, CB (?), I (?)
- **Rebar:** AS-T, HK-T, KHS-T, IDST
- **Shaft:** L, GR, IM, BR, AB, CI, SDR, TSM, CSS
- **Pipe:** RRC, SIO, SPO-A, P-1 (?), R (?), T-5 (?), T-2 (?), I-1 (?)
- **Aluminium:** SA1, SA2, SA21, IA1, IA2, HA2 (?)
- **Other:** VENAMEL, MADERO, V-CON, LX, SBL, EIKO, GASANO, QUEEN

(?) = a guess from where the code sits in the name. Please confirm.

### Grades

- **A** (paper: `STD (A)`) — 5 items, all CNP BESI
- **B** — 8 items (CNP BESI, PLAT BESI SPHC MB B)
- **C** — none in the list yet

## 7. Still needed

1. **What does (\*) mean?** 37 items. `VM` and `VM(*)` are separate items in the list, so they are kept
   apart (shown as `VM*`).
2. **What does NS mean?** 10 items, e.g. `PLAT BESI 1MMX4'X8' CB NS`, `FLANGE 5" 10K NS`. Non-standard?
3. **14 names appear twice** in the list. Same item (merge into one) or different items?
4. **Units** for Kawat Bendrat, Kawat Las, Paku, Cat and aluminium coils (25M / 50M):
   Roll, Dus, Kg, Kaleng, Pail?
5. **Possible typos:** `AS SS201 2 1/2MMX600-635CM` (2 1/2" inch?), `CNP BESI 75X35MMX2X1.8M` (no length?).
6. The **DO export file** for the later DO import.
