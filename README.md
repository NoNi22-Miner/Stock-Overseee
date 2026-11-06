# Stock-Overseee

Android app (Expo / React Native) for tracking stock across multiple locations, such as
**WRH** (warehouse) and **TOKO** (store), with barcode scanning for stock in and stock out.

## Features

- **Locations**: WRH and TOKO are set up by default. Add more (e.g. `TOKO2`) under *More*.
- **Scan**: choose *Stock In*, *Stock Out* or *Transfer*, pick the location(s), then scan with the
  camera or type the barcode (USB/Bluetooth scanners that "type + Enter" also work).
  Unknown barcodes can be registered on the spot.
- **Transfer WRH → TOKO**: moves stock between locations as one logged transaction.
- **Products**: barcode, name, unit, and a minimum stock level.
- **Stock**: per-location stock list with search and a *Low stock* filter. A badge on each
  location shows how many items are at or below their minimum.
- **History**: every movement, filterable by location and type.

## Data (Supabase)

Project: `stock-overseee` (region ap-southeast-1). The schema is in
[`supabase/migrations`](supabase/migrations).

| Table / view       | Purpose                                                 |
| ------------------ | ------------------------------------------------------- |
| `locations`        | WRH, TOKO, …                                            |
| `products`         | Product master (unique barcode, unit, `min_stock`)      |
| `stock_levels`     | Current qty per product per location (never below 0)    |
| `movements`        | Log of IN / OUT / TRANSFER                              |
| `stock_overview`   | Every product × location with qty and `is_low`          |
| `movement_history` | Movements with product name and location codes          |

Stock can only change through the `record_movement()` function. It updates the stock and writes
the log row in one transaction, and refuses to take out more than is available. The app talks to
Supabase with the publishable key in `.env`. Only signed-in users can read or write data.

## Run it

### Quick test with Expo Go

Everything the app uses (camera scanner included) is built into Expo Go, so no custom build is needed.

1. Install **Expo Go** from the Play Store on your Android phone.
2. On a computer with Node.js 20+:
   ```bash
   git clone https://github.com/NoNi22-Miner/Stock-Overseee
   cd Stock-Overseee
   npm install
   npx expo start            # add --tunnel if phone and computer are on different networks
   ```
3. Open Expo Go and scan the QR code shown in the terminal.

The phone and computer must be on the same Wi-Fi (or use `--tunnel`). Expo Go must support
SDK 58; update Expo Go if it says the project is incompatible.

### Installable APK (no computer needed to run it)

```bash
npx eas-cli@latest build --profile preview --platform android
```

## Teams, accounts & roles

Each **Team Leader** signs up with email and gets their own team. Teams never see each other's data
(locations, products, stock, history, members).

| Role            | Signs in with              | Can do                                                                    |
| --------------- | -------------------------- | ------------------------------------------------------------------------- |
| **Team Leader** | Email                      | Everything in their team, creates / edits / disables / deletes accounts, deletes the team |
| **Oversee**     | UserID or Username         | See who is online, adjust stock, stock in/out/transfer, manage products & locations |
| **Staff**       | UserID or Username         | Stock in / out; transfer only if the Team Leader allows it                |
| **Onlooker**    | UserID or Username         | Look at stock and history only                                            |

- The login screen has one box: **UserID / Username / Email**. `resolve_login()` turns a UserID or
  Username into the account's internal Auth email (`<random key>@users.stock-overseee.invalid`);
  unknown names get a stable fake address, so the login screen never reveals which names exist.
- **Sign up** (login screen) is for new Team Leaders only. After confirming their email and signing in
  they name their team (`create_team()`), and WRH + TOKO are created for them.
- Team Leaders create members in **Team → + Add account** (UserID, optional Username, name, role,
  password). This runs in the `manage-users` Edge Function, which only acts inside the caller's team.
- **More → Delete team & account** removes the Team Leader, every member and all team data
  (required for Play Store apps that let people create accounts).
- Rules are enforced in the database (Row Level Security + `record_movement` / `record_adjustment`
  check the caller's team and role), not only in the app.

### Before publishing to the Play Store

- Supabase → Authentication → **SMTP**: set up your own email sender; the built-in one only sends a
  few emails per hour, which is not enough for public sign-ups.
- Supabase → Authentication → **URL Configuration**: set the Site URL to your website, so the
  email confirmation link lands on a real page.
- Play Console needs a privacy policy URL and an app signed with your own upload key (AAB).
