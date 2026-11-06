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

## Accounts & roles

| Role         | Sign in with | Can do                                                                  |
| ------------ | ------------ | ----------------------------------------------------------------------- |
| **Owner**    | Email        | Everything, plus create / edit / disable / delete accounts              |
| **Oversee**  | User ID      | See who is online (Team tab), adjust stock, stock in/out/transfer, manage products & locations |
| **Staff**    | User ID      | Stock in / out / transfer only                                          |
| **Onlooker** | User ID      | Look at stock and history only                                          |

- The Owner creates accounts in the app: **Team → + Add account** (User ID, name, role, password).
- User IDs are stored in Supabase Auth as `<userid>@users.stock-overseee.invalid`; nobody needs that address.
- Account changes go through the `manage-users` Edge Function (`supabase/functions/manage-users`), which
  checks that the caller is the Owner.
- Rules are enforced in the database (Row Level Security + `record_movement` / `record_adjustment`),
  not only in the app.
- An account with no role (for example someone who used the public sign-up API) sees nothing.
  You can also turn off public sign-ups in Supabase: *Authentication → Sign In / Providers →
  Allow new users to sign up*.
