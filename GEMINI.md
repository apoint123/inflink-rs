# GEMINI.md - AI Context File

This document provides an overview of the **InfLink-rs** project, its architecture, and development conventions. It is intended to be used as a contextual reference for AI-powered development assistance.

## Project Overview

**InfLink-rs** is a high-performance plugin for the **BetterNCM** modding platform for the Netease Cloud Music desktop client. Its primary function is to integrate the music player with the native **Windows System Media Transport Controls (SMTC)**. This allows users to view song information (title, artist, album art) and control playback (play, pause, next, previous) directly from the Windows volume and media overlay.

A key feature of the project is its adaptive architecture, designed to support multiple versions of the Netease Cloud Music client, including both the modern **64-bit (v3)** and legacy **32-bit (v2)** releases.

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

*   **v2 Provider (`versions/v2/index.ts`)**: The implementation for the legacy 32-bit client. This provider is a hybrid solution derived from reverse-engineering.
    *   **Method**: Combines multiple client-side APIs.
    *   **State Reading**:
        *   Uses the `legacyNativeCmder` global object to subscribe to backend events like `Load`, `PlayState`, and `PlayProgress`.
        *   Crucially, it also subscribes to the **Redux store** to detect track changes *instantly*, providing a responsive UI experience that `legacyNativeCmder` events alone cannot.
        *   Reads the current play mode directly from the Redux store state.
    *   **Playback Control**:
        *   Uses a discovered global object, `ctl.defPlayer`, and its command dispatcher method `KJ("command")` to control playback (play, pause, next, prev, mode switching). This is more robust than DOM manipulation.
        *   Uses the `Qn(progress)` method for precise seek control.

### Build System & Packaging

The build process is configured to produce two separate, architecture-specific plugin packages.

*   **Dual-Target Compilation**: The Rust backend is compiled for both `x86_64-pc-windows-msvc` (64-bit) and `i686-pc-windows-msvc` (32-bit) targets.
*   **Parameterized Frontend Build**: The `vite.config.ts` reads a `TARGET_ARCH` environment variable (`x64` or `x86`) to:
    *   Dynamically set the output directory (e.g., `dist/v3` or `dist/v2`).
    *   Copy the corresponding 32-bit or 64-bit DLL, renaming it to the generic `smtc_handler.dll`.
    *   Copy the corresponding version-specific manifest file (`manifest.v3.json` or `manifest.v2.json`), renaming it to `manifest.json`.
*   **Final Output**: The `pnpm build` command orchestrates this entire process, resulting in two distinct, ready-to-distribute plugin packages.

## Development Conventions

The codebase demonstrates a strong preference for robust, modern, and maintainable practices.

### General

*   **Monorepo Management**: The project is a monorepo managed with `pnpm` workspaces.
*   **Commit Style**: Contributions should follow the **Conventional Commits** specification (e.g., `feat:`, `fix:`, `refactor:`).

### Frontend (TypeScript/React)

*   **Style & Linting**: **Biome** is used for formatting and linting.
*   **API Interaction**: Direct interaction with the client's internal APIs is abstracted away behind the version-specific Provider classes. This centralizes API knowledge and makes the code resilient to upstream changes.
*   **Robustness over Convenience**: The project has systematically replaced fragile implementation details (e.g., DOM manipulation) with more robust, future-proof strategies (e.g., dispatching Redux actions, calling internal JS methods, subscribing to client-provided event listeners).

### Backend (Rust)

*   **Style & Linting**: **Clippy** is used with strict rule sets (`pedantic`, `nursery`) enabled, indicating a high standard for idiomatic and safe Rust code.
*   **Logging**: The `tracing` crate is used for comprehensive, structured logging. Logs are piped to both a file and the frontend console, with dynamically configurable log levels.
*   **Safety**: While FFI necessitates `unsafe` code, its usage is localized. The project uses safe wrappers where possible.

### Testing & Validation

While the project lacks a formal automated testing suite, it follows a rigorous and pragmatic validation process:

1.  **Hypothesize**: Form a theory about how an internal API works (e.g., "Playback control is likely handled by a global `ctl.defPlayer` object").
2.  **Validate**: Write small, isolated scripts to test the hypothesis directly in the client's developer console (e.g., run `ctl.defPlayer.KJ("playnext")` and observe the result).
3.  **Implement**: Only after the hypothesis is proven correct, integrate the new, validated logic into the corresponding Provider class.

This iterative, evidence-based approach is crucial when working with and reverse-engineering a closed-source application.