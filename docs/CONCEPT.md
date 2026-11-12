# Stock Overseee — Final concept & system

Status: **agreed concept, 6 Nov 2026.** ✅ = built and live. 🔨 = agreed, to build.

## 1. What it is

A free Android app (English + Bahasa Indonesia) for small businesses to track stock across their own
places: warehouses (WRH), shops (TOKO) and any other location. Stock changes by **scanning barcodes**.
Every business is a separate **team**; teams never see each other's data.

## 2. Teams & accounts

| | |
|---|---|
| ✅ Sign up | A **Team Leader** signs up with email + password, confirms the email, then names the team. WRH and TOKO are created. |
| ✅ Members | The Team Leader creates member accounts: **UserID** (required), **Username** (optional), name, role, password. |
| ✅ Login | One box for everyone: **UserID / Username / Email** + password. Wrong details always give the same message, so nobody can find out which accounts exist. |
| ✅ Disable / delete | The Team Leader can disable, re-enable or delete members. |
| ✅ Delete team | The Team Leader can delete the team, all members and all data (required by the Play Store). |
| ✅ Location access | The Team Leader gives each member **All locations** or a chosen list (e.g. only TOKO), in **Team → account**. |

## 3. Roles

| Can… | Team Leader | Oversee | Staff | Onlooker |
|---|:-:|:-:|:-:|:-:|
| See stock & history (own locations) | ✅ all | ✅ | ✅ | ✅ |
| Stock In / Out | ✅ | ✅ | ✅ | — |
| Transfer | ✅ | ✅ | if allowed | — |
| Adjust (stock count) | ✅ | ✅ | — | — |
| Add / edit products, categories, locations | ✅ | ✅ | — | — |
| See who is online (Team tab) | ✅ | ✅ | — | — |
| Create / manage accounts, rename / delete team | ✅ | — | — | — |

**Location rules (✅):**
- The Team Leader always has every location. Other members see stock, history and Home numbers only for
  **their** locations.
- **In** needs access to the destination; **Out** and **Adjust** need access to that location.
- **Transfer** needs access to the **source** only, so WRH staff can send to TOKO without seeing TOKO.
- Products and categories are shared by the whole team. Members see stock numbers only for their
  locations.

## 4. Stock

| | |
|---|---|
| ✅ Locations | Code + name + type (warehouse / store / other). They can be turned off but not deleted, so history stays. |
| ✅ Products | Barcode (unique per team), name, unit, minimum stock (low-stock warning). |
| ✅ Categories | Each product has one category (e.g. Steel Shaft, Steel Pipe, Steel Knee), or "Uncategorized". Team Leader / Oversee manage the list in **Products → Categories**; deleting a category makes its products Uncategorized. |
| ✅ Movements | **In**, **Out**, **Transfer**, **Adjust** (set the counted quantity). Stock can never go below 0. Every movement records who, when and an optional note. |
| ✅ Transfers | **Send → in transit → receive.** Stock leaves the source when sent; the destination confirms what arrived: **all**, or **fewer** (the transfer becomes **Short**). Missing items stay open until the sender or a Team Leader / Oversee marks them **returned to source**, **arrived late** or **lost**. Shown in the **Transfers** tab (To receive / Short / On the way / Done). |

## 5. Home dashboard

✅ Built:
- Month picker; numbers reset every calendar month.
- Tiles: movements, items moved, low-stock items.
- Top 5 most moving and Top 5 least moving, by **Qty** or **Times**.
- Daily chart for all items and for each item that moved.
- In + Out + Transfer count as movement; Adjust does not.

✅ With categories:
- A **category filter** (All / Steel Shaft / Steel Pipe …) for the tiles, Top 5 lists and item charts.
- A **Movement by category** chart (always all categories); tap a category to filter.

## 6. Notifications

The people **responsible for a location** are the Team Leader plus every member assigned to it.

| Event | Who is notified |
|---|---|
| ✅ Transfer sent | Destination's people: "Incoming to TOKO — please receive it" |
| ✅ Transfer received in full / short | Source's people + the sender: "TOKO received everything" or "TOKO is short 2 — 48 of 50 arrived" |
| ✅ Missing items resolved | Both locations' people + the sender |
| ✅ Any stock change (In / Out / count / receive) | That location's people (each person can turn this off in **More → Notifications**) |
| ✅ Low stock | That location's people, when an item drops to or below its minimum |

Nobody is notified about their own action.
- ✅ **In-app Inbox** with an unread badge in the side menu. Tapping a notification opens the transfer
  or product.
- ✅ **Phone push notifications**, which also arrive when the app is closed. The app and server are
  ready; they start working after the one-time Firebase setup in [PUSH_SETUP.md](PUSH_SETUP.md).

## 7. Working without internet (✅)

- **First login needs internet.** After that the account works offline on that phone.
- The phone keeps a **copy** of products, locations and stock (refreshed whenever online), so scanning,
  word matching and stock lookups work offline.
- **In, Out and Transfer** made offline (or when the connection drops mid-send) are saved in a
  **queue** on the phone and sent in order automatically: on reconnect, every 30 s, or with **Send now**.
- Each queued scan has a unique ID, so a retry is never counted twice (`record_movement_sync`).
- If the server refuses one when it syncs (e.g. not enough stock), it shows as **"Not synced: …"** on
  the **Waiting to sync** screen, where the quantity can be corrected and retried, or the scan discarded.
- **Online only:** Adjust (a count must be checked against current stock), adding products, receiving
  transfers, account and team settings.
- History shows the **scan time**, marked "(scanned offline)" when it synced later. The dashboard counts
  it on the day it was scanned.

## 7b. Scanning words (✅)

Many items have no barcode, only a printed name. The camera has two modes:
- **Barcode**: reads a barcode or QR code.
- **Words**: takes a photo of the label and reads the text on the phone (Google ML Kit, works
  offline). The app ranks products by how closely their **name or code** matches, tolerating OCR
  mistakes, extra words and different word order; **sizes must agree** (30mm ≠ 20mm, 1/2" ≠ 3/4").
  A clear best match is picked automatically, with "Not this one?" alternatives. Otherwise the closest
  matches are listed to choose from.
- Typing a name in the scan box uses the same matching.

## 7c. Theme & layout — company branding (✅)

Set by the **Team Leader** in More → Theme & layout; everyone in the team gets the same look.

- **Company:** name and logo. The logo shows in the screen headers, on Home and on the login screen
  (the phone remembers the last team's look, also offline). It is stored small (256 px PNG).
- **Main color:** taken from the logo automatically (up to 5 choices), or picked from a palette or a
  color code. Colors are adjusted so text stays readable.
- **Mode:** light or dark. On dark mode the logo sits on a light plate.
- **Menu:** side panel on the left, on the right, or tabs along the bottom.
- **Spacing:** compact, normal or roomy.
- **Home page:** each section can be turned off and moved up or down.
- Saved in `teams.theme`. Members get a new look the next time they open the app.

### Text & icon size — each person's own (✅)

More → Text & icon size. Small / Normal / Large / Extra large for text, and the same for icons,
with a preview. Saved on the phone per account (not shared with the team), so young and older
users can each have a comfortable size, also on a shared phone. The side bar is slimmer by default
and grows with the chosen sizes.

## 7d. Plans (✅ codes; Google Play later)

Free (1 location, 1 account per role), Pro Monthly $1, Pro Lifetime $10 (many locations, up to 20
per role), Supporter $20 (Pro Lifetime + feature requests answered first + badge). When Pro ends,
extras are locked, never deleted. Activated with codes for now. Details: `docs/PLANS.md`.

## 8. Export (🔨)

Generated on the device and shared through Android's share menu (WhatsApp, email, Drive, print):

| Report | Excel (.xlsx) | PDF |
|---|:-:|:-:|
| Stock list (all locations or one; category filter) | ✅ | ✅ |
| History (date range, location, type) | ✅ | ✅ |
| Monthly summary (the Home page numbers + Top 5) | ✅ | ✅ |

Members can export only what they can see.

## 9. Language (🔨)

English and Bahasa Indonesia. The app follows the phone's language; it can be changed in **More**.

## 10. Security

✅ In place:
- All rules are enforced in the **database** (row-level security and checked stock functions), not
  only in the app. A modified app still can't see another team or skip a role.
- Member logins use random internal addresses; account changes run in a server function that
  checks the caller is that team's Team Leader.

## 11. Before the Play Store (🔨)

- Own email sender (SMTP) in Supabase, so sign-up confirmation emails aren't rate-limited.
- Site URL for the confirmation link.
- Privacy policy page and the Play Console **Data safety** form.
- Release signing with your own upload key; build an **AAB** instead of the test APK.
- Store listing: icon, screenshots, description (EN + ID).

## 12. Build order

1. ✅ Categories, location access, transfers in transit, in-app notifications.
1. ✅ Phone push notifications.
1. ✅ Offline scanning and word scanning.
2. **Offline queue** (local copy, queue, sync, failed-scan handling).
3. **Excel / PDF export.**
4. **Bahasa Indonesia.**
5. **Play Store preparation**, then one test APK for a full check on the tablet.

## Data model (for reference)

- `teams` — one per Team Leader.
- `profiles` — member: team, role, UserID, Username, active, can_transfer, online status.
  `all_locations`, `notify_changes`.
- `member_locations` — which locations a member may use.
- `transfers` — sent / received / returned / arrived late / lost quantities and status.
- `notifications` — per-person inbox; `push_tokens` — registered phones.
- `locations`, `products` (with `category_id`), `categories` — all per team.
- `stock_levels` — quantity per product per location.
- `movements` — log of In / Out / Transfer / Adjust with who did it, and `scanned_at`;
  `sync_receipts` — offline scans already recorded (no double counting).
- Functions: `record_movement`, `record_adjustment`, `create_team`, `resolve_login`, `movement_daily`.
  Edge Function `manage-users`.
