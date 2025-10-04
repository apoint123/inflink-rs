# GEMINI.md - AI Context File

This document provides an overview of the **InfLink-rs** project, its architecture, and development conventions. It is intended to be used as a contextual reference for AI-powered development assistance.

## Project Overview

**InfLink-rs** is a high-performance plugin for the **BetterNCM** modding platform for the Netease Cloud Music desktop client. Its primary function is to integrate the music player with the native **Windows System Media Transport Controls (SMTC)**. This allows users to view song information (title, artist, album art) and control playback (play, pause, next, previous) directly from the Windows volume and media overlay. **A secondary, but powerful feature is the embedding of the Netease Cloud Music song ID into the SMTC's metadata (using the `Genres` field), enabling precise song identification for third-party applications.**

A key feature of the project is its adaptive architecture, designed to support multiple versions of the Netease Cloud Music client, including both the modern **64-bit (v3)** and legacy **32-bit (v2)** releases, via a **single, universal plugin package**.

The project follows a modern monorepo architecture, combining the strengths of Rust for backend performance and safety with a TypeScript/React frontend for the user interface.

### Architecture & Technologies

The project is architecturally divided into two main parts that communicate via a native FFI bridge:

1.  **Rust Backend (`smtc_handler`)**:
    *   **Language**: Rust
    *   **Role**: The core of the plugin. It is compiled into native dynamic libraries (`.cdylib`) for both **x64 and x86** architectures.
    *   **Responsibilities**:
        *   Interfacing directly with the Windows API (`windows-rs` crate) to manage the SMTC session.
        *   Exposing a set of native functions to the JavaScript environment.
        *   Receiving commands from the frontend and forwarding events (e.g., SMTC button presses) back to it.
        *   **Interoperability Feature**: Sets the SMTC `genre` field to `NCM-{ID}` to allow other applications to identify the currently playing track.
    *   **Key Crates**: `cef-safe` (for safe communication with the Chromium Embedded Framework), `windows`, `tracing` (for structured logging), `serde` (for data serialization).

2.  **TypeScript Frontend (`InfinityLink`) - Version-Adaptive**:
    *   **Language**: TypeScript with React and Material UI (MUI).
    *   **Role**: Acts as a version-aware bridge between the Rust backend and the specific Netease client version it's running on.
    *   **Core Strategy**: The frontend employs a **dynamic Provider model** to abstract away version-specific implementation details. At runtime, it detects the client version and loads the corresponding "Provider" module, which is responsible for all interaction with the client.

### Provider Architecture

All version-specific logic is encapsulated within Provider classes that adhere to a common interface.

*   **`BaseProvider` (`versions/provider.ts`)**: A universal abstract class that defines the API contract for all providers. It establishes an event-driven model (`addEventListener`, `dispatchEvent`) that the rest of the application relies on, ensuring the core logic remains decoupled from any specific client version.

*   **v3 Provider (`versions/v3/index.ts`)**: The implementation for the modern 64-bit client.
    *   **Method**: Interacts almost exclusively with the client's **Redux store**.
    *   **State & Control**: Both reading player state (current song, play mode) and controlling playback (play, pause, next) are achieved by accessing the store's state and dispatching Redux actions.

*   **v2 Provider (`versions/v2/index.ts`)**: The implementation for the legacy 32-bit client. This provider is a sophisticated hybrid solution derived from reverse-engineering, designed for maximum robustness.
    *   **Method**: It combines multiple client-side data sources for state reading but relies exclusively on robust internal JavaScript APIs for playback control.
    *   **State Reading**:
        *   Uses the `legacyNativeCmder` global object to subscribe to backend events like `Load`, `PlayState`, and `PlayProgress`.
        *   Crucially, it also subscribes to the **Redux store** to detect track changes *instantly*, providing a responsive UI experience that `legacyNativeCmder` events alone cannot.
        *   Reads the current play mode directly from the Redux store state.
    *   **Playback Control**:
        *   By dynamically resolving the **currently active player instance** (e.g., `defPlayer`, `fmPlayer`, `mvPlayer`) by calling a discovered global method, `ctl.player.Hn()`, we can ensure that SMTC controls work correctly across all of the client's playback modes.
        *   All direct interactions with the client's obfuscated internal methods (e.g., `KJ`, `Qn`, `Gn`, `tQ`) have **encapsulated within a dedicated `NcmV2PlayerApi` wrapper class**. This adapter exposes a clean, intention-revealing API (`resume()`, `getProgress()`, etc.) to the provider, completely isolating the core logic from the fragile implementation details of the reverse-engineered API.

### Build System & Packaging (Universal)

The build process is configured to produce a **single, universal plugin package** that works on both 32-bit and 64-bit clients, leveraging a clever loading mechanism within BetterNCM.

*   **Dual-Target Backend Compilation**: The Rust backend is compiled for both `x86_64-pc-windows-msvc` (64-bit) and `i686-pc-windows-msvc` (32-bit) targets.
*   **Unified Frontend Build**: The `vite.config.ts` orchestrates a single build process with a universal output.
    *   **Output Directory**: All artifacts are placed in a single `InfinityLink/dist` directory.
    *   **DLL Handling**:
        *   The 32-bit DLL is copied and named `smtc_handler.dll`.
        *   The 64-bit DLL is copied and named `smtc_handler.dll.x64.dll`.
    *   **Manifest Handling**: A single, universal `manifest.json` is copied to the output directory. Its `native_plugin` key points to the base `smtc_handler.dll`.
*   **BetterNCM Loading Mechanism**: When the plugin is loaded, BetterNCM first tries to load `smtc_handler.dll`. On a 64-bit client, this fails, and it then automatically tries to load `smtc_handler.dll.x64.dll`, which succeeds. On a 32-bit client, the first attempt succeeds.
*   **Final Output**: The `pnpm build` command produces one ready-to-distribute, universal plugin folder.

## Development Conventions

### General

*   **Monorepo Management**: The project is a monorepo managed with `pnpm` workspaces.
*   **Commit Style**: Contributions should follow the **Conventional Commits** specification.
*   **Versioning & Changelog**: The project uses **Changesets** for version management and automated changelog generation.
    *   **Daily Workflow**: Run `pnpm cs:add` after completing a meaningful change.
    *   **Release Workflow**: Run `pnpm cs:version`, which calls `changeset version` and then a custom `scripts/sync-versions.js` script to propagate the new version number to all relevant files (`Cargo.toml`, `manifest.json`, etc.).

### Frontend (TypeScript/React)

*   **Style & Linting**: **Biome** is used for formatting and linting.
*   **API Abstraction**: Client-specific internal APIs are strictly abstracted behind Provider classes. Obfuscated methods are further encapsulated in dedicated wrapper classes (e.g., `NcmV2PlayerApi`).

### Backend (Rust)

*   **Style & Linting**: **Clippy** is used with strict rule sets (`pedantic`, `nursery`) enabled, indicating a high standard for idiomatic and safe Rust code.
*   **Logging**: The `tracing` crate is used for comprehensive, structured logging. Logs are piped to both a file and the frontend console, with dynamically configurable log levels.
*   **Safety**: While FFI necessitates `unsafe` code, its usage is localized. The project uses safe wrappers where possible.

### Release Automation

The project utilizes GitHub Actions for a fully automated release process.

*   **`release.yml`**: Triggered on `v*.*.*` tags. This workflow builds the universal plugin, packages it into a `.plugin` file, and attaches it to a new GitHub Release.
*   **`publish-store.yml`**: Also triggered on `v*.*.*` tags. This workflow builds the project and pushes the raw plugin contents (from `InfinityLink/dist`) to a dedicated `release` branch. This branch serves as a stable, clean distribution source for the BetterNCM plugin store.