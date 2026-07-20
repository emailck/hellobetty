# Android Native DOX

## Purpose
- Own the Expo-generated Android project used for emulator and device development builds.

## Ownership
- Expo app configuration in `../app.json` owns application permissions and generated native settings.
- This subtree owns only Android-specific build artifacts and configuration required by Expo.

## Local Contracts
- Do not manually edit generated files unless an Android-specific requirement cannot be expressed through Expo configuration.
- Regenerate this project through Expo after changing app configuration that affects native settings.
- Release builds may use cleartext HTTP only for the emulator loopback hosts `127.0.0.1` and `localhost`; all other cleartext destinations remain blocked.

## Work Guidance
- Use `JAVA_HOME`, `ANDROID_HOME`, and `ANDROID_SDK_ROOT` only for the current build command when they are absent from the system environment.
- Target an already-running AVD through `ANDROID_SERIAL` for non-interactive builds.
- Android emulator requests to the local API use `127.0.0.1` with `adb reverse tcp:4100 tcp:4100` so development does not depend on Windows inbound firewall rules.
- Follow `../../../docs/android-emulator-debugging.md` as the canonical Windows emulator startup and recovery procedure.

## Verification
- Run `npx expo run:android --port <port>` from `apps/mobile/`.
- Confirm the app process with `adb shell pidof com.anonymous.hellobetty`.

## Child DOX Index
