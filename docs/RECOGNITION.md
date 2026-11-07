# Item recognition — final concept

Status: **agreed concept, not built yet** (7 Nov 2026). Replaces the earlier full-page DO idea.

## 1. Item structure (the Recognition Table)

Every item is built from parts picked from lists. The app writes the name, so the same item is always
spelled the same way.

| Part | Example | Required | List |
|---|---|:-:|---|
| **Category** | BESI BETON ULIR, PLAT BESI | ✅ | per team; each category has its **own size pattern** |
| **Grade** | A / B / C | – | one list for all categories |
| **Label** (standard / jurisdiction) | U-280, SS400 | – | per team |
| **Size** | 16mm × 12m · 16mm × 4' × 8' | ✅ | boxes follow the category's size pattern |
| **Brand** | AS-T, VM\* | – | per team |
| **Unit** | Lembar / Batang / Pcs / Kg | ✅ | Kg allows decimals; Lembar, Batang and Pcs are whole numbers |

- **Type** = Category + Grade, e.g. "PLAT BESI A".
- The name is built automatically, in this order:
  - **Category Grade · Label · Size · Brand**
  - e.g. **PLAT BESI A · SS400 · 16mm × 4' × 8' · VM\***
  - e.g. **BESI BETON ULIR · U-280 · 16mm × 12m · AS-T**
- **Size patterns** are set per category by the Team Leader / Oversee. Examples:
  - Besi Beton Ulir: Diameter (mm) × Panjang (m)
  - Plat Besi: Tebal (mm) × Lebar (ft) × Panjang (ft)
  - Pipa: Diameter (inch) × Tebal (mm) × Panjang (m)
- **Other spellings (aliases)** on every list entry, because paperwork spells things differently:
  - "BESI BETON ULIR" = "BB ULIR" = "BESI ULIR"
  - "U-280" = "U280" = "U 280"
  - "AS-T" = "AST"
  - "SS400" = "SS 400"
  - "VM\*" = "VM"
- **Locations get aliases too.** "PNK IPS" / "PNK1PS" = **WRH**, ready for the DO file import later.
- No duplicates: the same Category + Grade + Label + Size + Brand can exist only once.
- **Weight (KG) is not tracked** in this version (possible next update: weight per unit).
- Existing items keep working. They show as **"not structured"** until someone edits them into parts.

## 2. Setting up and adding items

- **Recognition Table screen** (Products → Recognition Table, Team Leader / Oversee only):
  - tabs **Categories** (with size pattern), **Grades**, **Labels**, **Brands**
  - every entry has a list of other spellings
- **Add item:** Category → Grade → Label → size boxes → Brand → Unit → Save.
- **Excel import of items:**
  - Download the template: Category · Grade · Label · Size 1 · Size 2 · Size 3 · Brand · Unit · Min stock.
  - Fill it in and import it.
  - A check list comes first: new items, duplicates, and unknown categories / labels / brands (these can
    be created during the import). Nothing is saved until the Team Leader confirms.

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

4. **List of possible items**, best first, each showing which parts matched:

   ```
   BESI BETON ULIR · U-280 · 16mm×12m · AS-T     ✓Category ✓Size ✓Label ✓Brand
   BESI BETON ULIR · U-280 · 16mm×12m · KS       ✓Category ✓Size ✓Label
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
- **Matching** runs on the phone against the saved item list, so it also works offline.
  - Each part is matched through its list and aliases.
  - Sizes are read from patterns like `16MMX12M`, `16 x 4 x 8` and `16mm × 4' × 8'`, and compared
    number by number.
- **Database:**
  - new tables `grades`, `labels`, `brands`, `product_aliases` (learned spellings)
  - `categories.size_pattern` and `aliases` on every list (and on locations)
  - products get `grade_id`, `label_id`, `brand_id`, `size` (values) and `unit`
    (lembar / batang / pcs / kg)
  - all per team, with the same security rules as today

## 6. Still needed

- Your **categories and size patterns**. They can also be typed into the Recognition Table later.
- The **DO export file** for the later DO import.
