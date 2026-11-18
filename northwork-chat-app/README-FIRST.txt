NORTHWORK CHAT — FIRST SETUP

1. Extract this ZIP.
2. Copy .env.example to .env.
3. Paste the existing Northwork sb_publishable_... key into EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY.
4. Paste your existing GIPHY Web API key into EXPO_PUBLIC_GIPHY_API_KEY (optional, for GIF search).
5. Open a terminal in this folder and run:

   npm install
   npx expo install --fix
   npx expo start

The app uses the same Supabase project and chat tables as the Northwork website. It does not create or reset chat tables. Never paste a Supabase secret/service_role key into this app.

See README.md for Android APK and iOS build instructions.
