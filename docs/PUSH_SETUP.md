# Phone push notifications: one-time setup

The app already shows notifications in its **Inbox**. These steps also make them pop up on the phone
when the app is closed. Everything is free and can be done in a tablet browser.

## 1. Create a Firebase project

1. Open <https://console.firebase.google.com> and sign in with a Google account.
2. **Create a project** → name it `Stock Overseee` → you can turn **Google Analytics off** → **Create**.

## 2. Add the Android app and get `google-services.json`

1. In the project, tap the **Android** icon (“Add app”).
2. **Android package name:** `com.noni22.stockoverseee` (exactly this). Leave the rest empty.
3. **Register app** → **Download google-services.json**.
4. Send this file to the project, either way:
   - **Easiest:** open the file, copy all of its text, and paste it to Claude in the chat. It is not
     a secret; it is meant to be built into the app.
   - Or on GitHub: open the repository on branch `ccr-e5e142db-hisdnj` → **Add file → Upload
     files** → choose `google-services.json` → **Commit changes**. It must be in the top folder.
5. Skip the remaining “Add Firebase SDK” steps; the app already has them.

## 3. Give the server permission to send (this one IS secret)

1. In Firebase: ⚙️ **Project settings → Service accounts → Generate new private key → Generate key**.
   A `.json` file downloads.
2. Open <https://supabase.com/dashboard/project/kvrogdhmjagrowpqzxqx/functions/secrets>.
3. **Add new secret:**
   - Name: `FCM_SERVICE_ACCOUNT`
   - Value: open the downloaded key file, copy **all** its text, paste it here.
4. **Save.**

⚠️ Never paste this key into a chat, email or GitHub. Supabase keeps it private.

## 4. Build the app

Tell Claude it is done. Claude adds `google-services.json` if you pasted it, sends a test notification,
and starts a new APK build. Install that APK, sign in, and allow notifications when Android asks.

## How it works (for reference)

- On sign-in, each phone registers with Firebase and the token is stored in `push_tokens`.
- Every new row in `notifications` triggers the `send-push` Edge Function (through `pg_net`). It sends
  the same title and text to that person's phones through Firebase Cloud Messaging.
- Tapping a notification opens the transfer or product it is about.
- On sign-out the phone stops receiving pushes for that account.
