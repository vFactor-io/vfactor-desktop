# Releasing Nucleus Desktop

## One-time setup

1. Add GitHub repository secrets for publishing and code signing.
   - `GH_TOKEN` or the default `GITHUB_TOKEN` for release publishing
   - macOS signing/notarization secrets if you want trusted macOS installers
   - Windows signing secrets if you want signed NSIS installers
   - `POSTHOG_API_KEY` if you want packaged builds to send PostHog events and captured exceptions
2. Add the optional repository variable `POSTHOG_HOST` if you use an EU or self-hosted PostHog instance.

## Optional code signing

- macOS signing and notarization are strongly recommended for a smoother install flow and production auto-update support.
- If you want trusted macOS builds, add Apple signing secrets and certificate import steps before running `electron-builder`.
- Windows binaries will build without code signing, but users may still see SmartScreen warnings until you add a Windows signing certificate.
- Current temporary state: the GitHub Actions mac release job intentionally forces an unsigned build while the Apple Developer account setup is still in progress. That means downloaded mac artifacts are usable for manual installs, but in-app mac auto-update install is expected to fail code-signature validation until signing and notarization are enabled.

## Release flow

1. Bump the version in `apps/desktop/package.json`.
2. Commit the version bump.
3. Create and push a tag like `v0.2.0`.
4. GitHub Actions builds macOS and Windows installers, writes a packaged runtime `.env` file from `POSTHOG_*`, uploads the installers to the GitHub Release, and publishes Electron update metadata (`latest.yml`, `latest-mac.yml`).

## Local release build

To test the release configuration locally:

```bash
bun run desktop:dist
```

If you want the packaged app to emit PostHog events locally, export `POSTHOG_API_KEY` and `POSTHOG_ENABLED=true` before running the build. The packaging step writes those keys into `Resources/.env` inside the app bundle so the Electron main process can load them after installation.

## In-app updates

- The packaged app checks GitHub Releases through `electron-updater`.
- When GitHub Releases contains a newer compatible build, Nucleus shows an in-app update banner, downloads the installer, and installs it directly.
- If PostHog is configured, updater checks, download completion, blocked restarts, install attempts, and updater failures are also captured from the packaged app.
