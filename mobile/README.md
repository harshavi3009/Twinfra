# Twinfra Mobile (Flutter, Android)

A **read-only** companion app for guards and staff. Detection and ticket
verification stay on the campus server — this app only reads.

## Screens
| Tab | What it does |
|---|---|
| Campus | WebView of the React 3D campus scene (pinch/drag/tap) |
| Buildings | Native list → floors → rooms, live power/occupancy |
| Alerts | Active + history, severity, explanation, linked ticket |
| Settings | Editable API URL, connection test, notification permission |

## Run it
```bash
export ANDROID_HOME=$HOME/android-sdk
export JAVA_HOME=/usr/lib/jvm/java-21-openjdk   # Gradle can't parse Java 27
flutter build apk --debug
adb install -r build/app/outputs/flutter-apk/app-debug.apk
```

The API URL is editable in **Settings** — the LAN IP changes between networks
and rebuilding an APK to fix an IP is not a demo-day activity.

## Reaching the API from the phone
- **USB (no Wi-Fi):** `adb reverse tcp:8010 tcp:8010`, then use
  `http://127.0.0.1:8010`.
- **Same Wi-Fi:** use `http://<laptop-lan-ip>:8010` (server must be
  `--host 0.0.0.0`).

## The 3D view
The scene is ~1,300 lines of react-three-fiber with a programmatic camera rig;
Flutter has no mature equivalent. So the app wraps the real scene in a WebView,
which gets pixel-identical output today.

Requirements, both easy to miss:
- `android:usesCleartextTraffic="true"` — Android 9+ blocks plain `http://`
- `canvas { touch-action: none }` — otherwise the WebView eats drags and
  `CameraControls` never sees them

The web app is desktop-first (fixed sidebar), so the WebView injects CSS to hide
`aside` on load. That's deliberately contained in `campus3d_screen.dart`, not
changed in Harshavi's components.

To let the WebView load the app, FastAPI serves `frontend/dist` at `/` when it
exists (`backend/app/main.py`). Build it with:
```bash
cd frontend && VITE_USE_MOCK=false VITE_API_URL=http://127.0.0.1:8010 npm run build
```

## Notifications — scope, stated honestly
These are **local notifications**, fired by a 30s poll inside the app:

- ✅ arrive while the app is open
- ❌ do **not** arrive when the app is closed

Real push-while-closed needs FCM (`google-services.json` + a backend sender).
That's the documented next step, not a bug.
