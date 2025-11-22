# GEMINI.md - AI Context File

This document provides an overview of the **InfLink-rs** project, its architecture, and development conventions. It is intended to be used as a contextual reference for AI-powered development assistance.

## 1. Project Overview

**Project Name:** InfLink-rs

**Description:**
InfLink-rs is a sophisticated plugin designed for the **NetEase Cloud Music (NCM)** desktop application (specifically via the BetterNCM plugin framework). Its primary function is to bridge the gap between the web-based NCM client and the native Windows operating system.

By utilizing a hybrid architecture of **TypeScript** (running in the client's Chromium environment) and **Rust** (running as a native backend), the project enables native **System Media Transport Controls (SMTC)** integration. This allows users to control music playback using hardware media keys, see track information in the Windows overlay, and sync their status with **Discord Rich Presence (RPC)**.

### 2. Key Features

* **System Media Transport Controls (SMTC) Integration:**
    * **Media Keys Support:** Enables the use of hardware Play, Pause, Stop, Next, and Previous buttons to control the NCM client.
    * **Native Windows Overlay:** Displays the current song title, artist, album, and high-resolution cover art in the Windows volume/media overlay.
    * **Timeline Synchronization:** Syncs the playback progress bar and duration with the Windows interface, allowing seeking from the OS UI.
    * **Play Mode Control:** allows toggling Shuffle and Repeat modes directly from the system controls.
* **Discord Rich Presence:**
    * Automatically updates the user's Discord status to show the currently playing track, artist, and album.
    * Displays the album art and a progress bar in the Discord profile activity.
    * Includes a "Listen" button redirecting to the song url.
* **Version Compatibility (Adapters):**
    * Includes robust adapters (`v2adapter` and `v3adapter`) to support different versions or rendering engines of the NetEase Cloud Music client (Legacy V2 and React-based V3).
* **Configurable UI:**
    * Provides a Material UI (MUI) based settings panel within BetterNCM.
    * Allows toggling SMTC and Discord features, adjusting cover art resolution, and managing log levels.

### 3. How it Works

The project follows a bidirectional communication architecture between the NCM Frontend (Chromium/V8) and the Native Backend (Rust).

#### A. The Frontend Layer (TypeScript/React)
1.  **State Extraction (Adapters):** The core logic relies on `v2/adapter.ts` and `v3/adapter.ts`. These modules inject themselves into the NCM client's internals.
    * **V3 Adapter:** Traverses the React Fiber tree or uses internal `dva` tools to locate the Redux store. It subscribes to state changes to detect song switches, volume changes, and play status.
    * **V2 Adapter:** Interacts with older obfuscated API endpoints (`playerInstance.KJ`) and distinct Redux stores.
2.  **Event Listener:** The adapters listen for specific NCM internal events (progress updates, seek actions) and normalize them into a standard `SongInfo` or `TimelineInfo` format.
3.  **Provider Facade:** `provider.ts` creates a unified interface over the adapters, abstracting away version differences for the rest of the application.

#### B. The Native Bridge (FFI & CEF)
1.  **Communication:** The frontend communicates with the backend via `smtc-rust.ts`, which calls native functions exposed by `ffi.rs`.
2.  **Thread Safety:** `task.rs` implements a mechanism to execute Rust closures on specific CEF (Chromium Embedded Framework) threads (specifically the Renderer thread). This ensures that V8 context operations are thread-safe.
3.  **V8 Interop:** `v8.rs` handles the conversion of data types between Rust and JavaScript strings/objects.

#### C. The Backend Layer (Rust)
1.  **SMTC Core:** `smtc_core.rs` uses the Windows Runtime (WinRT) APIs (`Windows.Media.Playback`) to initialize a virtual `MediaPlayer`.
    * It receives metadata updates from the frontend and pushes them to the Windows System Media Transport Controls.
    * It sets up event handlers for Windows media buttons. When a button is pressed, it triggers a callback that sends a message back to the Frontend to execute the command (e.g., `adapter.play()`).
2.  **Discord RPC:** `discord.rs` runs a background thread that connects to the Discord IPC. It receives metadata/timeline payloads and updates the user's activity status, handling connection retries and debouncing to prevent rate limits.
3.  **Async Runtime:** The backend uses the `tokio` runtime to handle asynchronous tasks like downloading cover art images or updating timeline properties without blocking the main thread.

### 4. Tech Stack

**Frontend:**
* **Language:** TypeScript
* **Framework:** React (using Hooks and Context)
* **UI Library:** Material UI (MUI)
* **Build Tool:** Vite
* **Target Environment:** Chromium (CEF) / BetterNCM

**Native Backend:**
* **Language:** Rust
* **Async Runtime:** Tokio
* **Windows API:** `windows` crate (WinRT/UWP integration for Media controls)
* **Browser Integration:** `cef-sys` (Raw bindings to CEF), `cef-safe` (custom V8 wrappers).
* **Discord Integration:** `discord-rich-presence` crate.
* **Utilities:** `serde` (Serialization), `tracing` (Logging), `anyhow` (Error handling).
