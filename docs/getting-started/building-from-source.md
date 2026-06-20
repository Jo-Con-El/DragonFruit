# Building from Source

This guide is for contributors and power users who want the latest bleeding-edge DragonFruit code.

If you only want to use DragonFruit, use prebuilt releases from the [Installation](installation.md) page.

## Prerequisites

Install the following before building:

- **Git**
- **Node.js** (LTS recommended) + `npm`
- **Rust toolchain** via `rustup`
- **Platform-specific Tauri system dependencies**

!!! tip
      If desktop build steps fail early, the most common cause is missing Tauri system dependencies on your OS.

## 1) Clone the repository

1. Clone `Open-Resin-Alliance/DragonFruit`.
2. Enter the repository root.

## 2) Install JavaScript dependencies

Install frontend/tooling dependencies:

- `npm install`

## 3) Optional: initialize plugin submodules

Some complex plugin integrations may be included as submodules under `plugins/`.

If you are working on those integrations, initialize/update submodules.
If not, DragonFruit can still run/build with available plugins and skips missing ones.

## 4) Run desktop development mode

Start the Tauri desktop app in development mode:

- `npm run tauri:dev`

This launches the desktop runtime and enables iterative frontend + backend development.

## 5) Build production artifacts

To create a release-style desktop build for your current OS:

- `npm run tauri:build`

Common outputs by platform:

- **Windows:** `.exe` (NSIS)
- **macOS:** `.dmg`
- **Linux:** `.flatpak` (project workflow may include additional Flatpak steps)

## 6) Useful verification commands

Run checks before opening a PR:

- `npm run lint`
- `npm run test`

## Common build issues

If a source build fails:

1. Re-check Tauri prerequisites for your platform.
2. Confirm Rust and Node are installed and on `PATH`.
3. Remove stale dependency/build caches, then reinstall.
4. Search existing reports or open a new issue:
   - https://github.com/Open-Resin-Alliance/DragonFruit/issues

## iOS simulator (experimental)

> Requires macOS with Xcode and the iOS Simulator runtime installed.

Build and run the app in the iOS Simulator:

```bash
npm run ios:build:sim          # compile for arm64 simulator
npm run ios:run:sim            # install and launch on iPad Pro 11-inch (M5)
npm run ios:run:sim -- 'iPad (A16)'  # override the target device
```

`ios:build:sim` removes the previous `.xcarchive` automatically before compiling. This is required because Tauri does a `rename()` of the new bundle into the archive and that syscall fails if the destination directory already exists.

The list of available simulators can be obtained with `xcrun simctl list devices available`.

## Next steps

- For user install paths and release channels, see [Installation](installation.md).
- For architecture and internals, continue to the Developer Guide.
