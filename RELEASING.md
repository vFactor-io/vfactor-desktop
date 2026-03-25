# Releasing Nucleus Desktop

## One-time setup

1. Add GitHub repository secrets for publishing and code signing.
   - `GH_TOKEN` or the default `GITHUB_TOKEN` for release publishing
   - macOS signing/notarization secrets if you want trusted macOS installers
   - Windows signing secrets if you want signed NSIS installers

## Optional code signing

- macOS signing and notarization are strongly recommended for a smoother install flow and production auto-update support.
- If you want trusted macOS builds, add Apple signing secrets and certificate import steps before running `electron-builder`.
- Windows binaries will build without code signing, but users may still see SmartScreen warnings until you add a Windows signing certificate.

## Release flow

1. Bump the version in `package.json`.
2. Commit the version bump.
3. Create and push a tag like `v0.2.0`.
4. GitHub Actions builds macOS and Windows installers, uploads them to the GitHub Release, and publishes Electron update metadata (`latest.yml`, `latest-mac.yml`).

## Local release build

To test the release configuration locally:

```bash
bun run dist
```

## In-app updates

- The packaged app checks GitHub Releases through `electron-updater`.
- When GitHub Releases contains a newer compatible build, Nucleus shows an in-app update banner, downloads the installer, and installs it directly.
