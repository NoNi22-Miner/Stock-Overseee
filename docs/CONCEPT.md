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
- 🔨 **Phone push notifications**, which also arrive when the app is closed. This needs a one-time free
  Firebase setup.

## 7. Working without internet (🔨)

- **First login needs internet.** After that the session stays on the device.
- The app keeps a **local copy** of products, locations and last-known stock, so scanning and lookups
  work offline.
- **In, Out and Transfer** made offline go into a **queue** on the device, marked "Waiting to sync".
  They are sent in order as soon as the connection is back.
- Each queued scan has a unique ID, so a retry can never be counted twice.
- **If a scan can't be applied** when it syncs (e.g. two people took the last item), it is not forced
  through. It shows as **"Not synced: not enough stock"**, so the user can change the quantity or
  discard it.
- **Online only:** Adjust (a count must be applied against current stock), adding products, account and
  team settings, and exports.
- History shows the **scan time** (when it happened on the device), plus the sync time when they differ.

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
1. **Phone push notifications** (needs the Firebase setup).
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
- `notifications` — per-person inbox.
- `locations`, `products` (with `category_id`), `categories` — all per team.
- `stock_levels` — quantity per product per location.
- `movements` — log of In / Out / Transfer / Adjust with who did it. 🔨 + `client_id` (offline
  de-duplication) and `scanned_at`.
- Functions: `record_movement`, `record_adjustment`, `create_team`, `resolve_login`, `movement_daily`.
  Edge Function `manage-users`.
