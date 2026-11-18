# Northwork Chat — Android + iOS

A standalone Expo / React Native client for Northwork's existing private direct-message system.

## Important: existing conversations are reused

This app is built against the database objects used by the current Northwork website. It does **not** create a second chat database or change conversation/message IDs.

- `public.northwork_conversations`
- `public.northwork_messages`
- `public.northwork_chat_reads`
- `public.northwork_public_profiles`
- `public.profiles` (the signed-in member's own profile)
- `public.northwork_start_direct_conversation(p_other_user_id uuid)`

It also reads and writes the same GIPHY message encoding: `NWGIF1:` followed by a JSON payload. Text messages and GIF messages sent in the mobile app will be visible in the website chat, and website messages will appear in this app through Supabase Realtime.

**No SQL migration is included or required** when the chat setup already used by the website is in place. Do not run a second copy of the chat schema just for the app.

## 1. Install the tools

Install Node.js 22.13 or newer, then install the Expo command-line tools when prompted by the commands below. SDK 58 currently targets React Native 0.88 and React 19.3.

You need:
- Node.js 22.13+
- npm
- Expo account for cloud builds
- Android phone with Expo Go or a development build for Android testing
- For iPhone testing, an iPhone with compatible Expo Go / development build; publishing to the App Store requires Apple Developer credentials

## 2. Configure the existing Supabase project

1. Copy `.env.example` to a new file named `.env` in this project folder.
2. Keep `EXPO_PUBLIC_SUPABASE_URL` set to the existing Northwork project URL.
3. Set `EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY` to the same `sb_publishable_...` key already used by the Northwork website.
4. Optionally set `EXPO_PUBLIC_GIPHY_API_KEY` to the GIPHY Web API key currently used by the website. The supplied `.env.example` already includes the publishable Supabase key that was in your website HTML; verify it still matches your project before building.

The app uses your existing Supabase Auth accounts. Members log in using their current Northwork email and password. It stores the auth session using AsyncStorage so it survives app restarts.

**Never use `SUPABASE_SECRET_KEY`, `SUPABASE_SERVICE_ROLE_KEY`, a database password, or any other server secret in this app.** `EXPO_PUBLIC_` variables are bundled into the client app and must be treated as public. The publishable key is safe only because your existing Supabase Row Level Security policies protect the database.

## 3. Install dependencies and run it

From this folder:

```bash
npm install
npx expo install --fix
npx expo start
```

Scan the QR code with Expo Go on an Android device. For iPhone, use the Camera app / Expo Go flow shown by Expo. SDK 58 support must be available in the installed Expo Go version; otherwise use a development build as described below.

To check TypeScript:

```bash
npm run typecheck
```

## 4. Build an Android APK for testing

```bash
npx eas-cli@latest login
npx eas-cli@latest build:configure
npx eas-cli@latest build --platform android --profile preview
```

The `preview` profile is configured to produce an installable APK for internal testing. EAS may ask you to create or link an Expo project; follow the prompts. EAS will write the Expo project ID into the project configuration during setup.

## 5. Build iOS

For an iOS device build:

```bash
npx eas-cli@latest build --platform ios --profile preview
```

EAS will guide you through the Apple signing setup. Apple Developer membership and Apple signing credentials are required for installing/distributing a production iOS app outside Expo Go. A Windows PC can start and manage cloud EAS builds; you do not need a local Mac for cloud builds.

For store builds after testing:

```bash
npx eas-cli@latest build --platform all --profile production
```

App Store / Google Play submission is a separate step and requires the relevant developer accounts, store listing information, icons, screenshots, privacy disclosures, and review.

## Current v1 features

- Existing Northwork Supabase email/password login and account creation
- Persistent authenticated session
- Existing inbox and direct conversations
- Search public Northwork members by username or display name
- Start a one-to-one conversation through the existing RPC
- Existing chat history (latest 250 messages are loaded when a thread opens)
- Text messaging, up to 3,000 characters
- GIPHY trending/search picker and GIF sending
- Animated GIF rendering using Expo Image
- Profile avatars from the existing `northwork_public_profiles` / `profiles` data
- Unread indicators and `northwork_chat_reads`
- Realtime new-message updates from `northwork_messages`
- Dark Northwork-style native interface

## What is intentionally not enabled yet

- **Push notifications:** realtime updates work while the app is online, but background push requires device tokens, native FCM/APNs credentials, and a trusted server-side sender (for example, a Supabase Edge Function). These should be added in a later step without putting server credentials in the app.
- **Profile editing / avatar uploads:** the app reads the current Northwork profile picture and display name; edits remain available on the website for this first mobile build.
- **Older-message pagination:** the app opens with the latest 250 messages in a conversation. The original records remain in Supabase and are not removed.

## Database compatibility notes

The app assumes the current website chat SQL has already been applied and that the `northwork_public_profiles` view exposes `id, display_name, username, avatar_url`. It uses the same `northwork_start_direct_conversation` RPC and existing RLS policies. If a request is denied, check the existing Northwork Chat SQL and profile migration; do not make the tables public to work around an RLS error.

## Useful official docs

- Supabase Expo React Native quickstart: https://supabase.com/docs/guides/getting-started/quickstarts/expo-react-native
- Supabase React Native auth: https://supabase.com/docs/guides/auth/quickstarts/react-native
- Expo SDK 58 reference: https://docs.expo.dev/versions/v58.0.0/
- Expo EAS Build: https://docs.expo.dev/build/introduction/
- Expo push notifications (future addition): https://docs.expo.dev/push-notifications/push-notifications-setup/


## 6. GitHub-triggered app updates (in-app update prompt)

This project includes `expo-updates` and a Northwork in-app update dialog. The app checks on launch, whenever it returns to the foreground, and every 15 minutes while open. When a compatible update is published, it shows **A new update is ready**. The member can tap **Install update**; the app downloads the bundle and reloads. This is an in-app prompt, not an OS push notification while the app is closed.

### One-time configuration

1. From this project folder, sign in to the same Expo account/project used for the Android APK:

   ```bash
   npx eas-cli@latest login
   npx eas-cli@latest update:configure
   ```

   Select/link the existing `northwork-chat` EAS project created for the APK. This command adds the `updates.url` and `extra.eas.projectId` values to `app.json`. Keep the `runtimeVersion` policy as `appVersion` and the manual `checkAutomatically: NEVER` setting.

2. Ensure the EAS **preview** environment contains these public app values:
   - `EXPO_PUBLIC_SUPABASE_URL`
   - `EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY`
   - `EXPO_PUBLIC_GIPHY_API_KEY`

   These were configured for the previous preview build. Do not add a Supabase secret/service-role key.

3. In GitHub, add the mobile project folder to the root of `SobiBossu/northwork-site` as `northwork-chat-app/`. Keep the website's root `index.html` unchanged. Copy the included `.github/workflows/northwork-chat-ota.yml` into the repository's `.github/workflows/` folder.

4. Create a GitHub repository Actions secret named `EXPO_TOKEN`. Create the token from your Expo account's Access Tokens page. Never put it in the workflow file or app code.

5. Commit and push. The first commit to `northwork-chat-app/` triggers the workflow. It publishes the mobile JS/assets to the `preview` and `production` EAS Update channels. Later pushes to files in that folder automatically publish compatible OTA updates.

### Rebuild once to enable updates

The previously installed APK was built before `expo-updates` was added. It cannot receive these OTA updates. After `update:configure` and the GitHub secret are in place, create a fresh binary:

```bash
npx eas-cli@latest build --platform android --profile preview
```

The new APK has the update client and preview channel. iOS uses the same code and `production`/`preview` channel configuration; physical-device distribution and TestFlight require Apple signing and an Apple Developer Program membership.

### What updates automatically?

- JavaScript/TypeScript app code, styling, and bundled assets can be delivered over the air when compatible with the installed native runtime.
- Changes to native dependencies, permissions, app identifiers, or other native configuration require new Android/iOS binaries. EAS runtime compatibility prevents an incompatible OTA update from being applied.
- Changes only to the website root `index.html` do not change the standalone mobile app. Update the `northwork-chat-app/` folder to change the phone app.
- GitHub is the trigger/source of code; EAS Update hosts and serves the compatible app bundle. The app checks while open/foregrounded, so it may take up to 15 minutes to display the dialog while a member keeps it open. On next launch it checks again.

