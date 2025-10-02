# GEMINI.md - AI Context File

This document provides an overview of the **InfLink-rs** project, its architecture, and development conventions. It is intended to be used as a contextual reference for AI-powered development assistance.

## Project Overview

**InfLink-rs** is a high-performance plugin for the **BetterNCM** modding platform for the Netease Cloud Music desktop client. Its primary function is to integrate the music player with the native **Windows System Media Transport Controls (SMTC)**. This allows users to view song information (title, artist, album art) and control playback (play, pause, next, previous) directly from the Windows volume and media overlay, providing a seamless, native OS experience.

The project follows a modern monorepo architecture, combining the strengths of Rust for backend performance and safety with a TypeScript/React frontend for the user interface.

### Architecture & Technologies

The project is architecturally divided into two main parts that communicate via a native FFI bridge:

1.  **Rust Backend (`smtc_handler`)**:
    *   **Language**: Rust
    *   **Role**: The core of the plugin. It is compiled into a native dynamic library (`.cdylib`) loaded by the BetterNCM host.
    *   **Responsibilities**:
        *   Interfacing directly with the Windows API (`windows-rs` crate) to manage the SMTC session.
        *   Exposing a set of native functions to the JavaScript environment.
        *   Receiving commands from the frontend and forwarding events (e.g., SMTC button presses) back to it.
    *   **Key Crates**: `cef-safe` (for safe communication with the Chromium Embedded Framework), `windows`, `tracing` (for structured logging), `serde` (for data serialization).

2.  **TypeScript Frontend (`InfinityLink`)**:
    *   **Language**: TypeScript
    *   **Framework/UI**: React with Material UI (MUI).
    *   **Role**: The bridge between the Rust backend and the Netease client's internal state.
    *   **Responsibilities**:
        *   Rendering the plugin's settings panel within the BetterNCM interface.
        *   Calling native functions exposed by the Rust backend.
        *   Listening for events from the backend (e.g., "next song" button pressed on the media overlay).
        *   **Crucially, it controls the music player by programmatically dispatching actions to the Netease client's internal Redux store, avoiding fragile DOM manipulation.**

This architecture ensures that the performance-critical and OS-specific logic is handled by robust Rust code, while the UI and integration with the client's web-based environment are managed with modern web technologies.

## Development Conventions

The codebase demonstrates a strong preference for robust, modern, and maintainable practices.

### General

*   **Monorepo Management**: The project is a monorepo managed with `pnpm` workspaces.
*   **Commit Style**: Contributions should follow the **Conventional Commits** specification (e.g., `feat:`, `fix:`, `refactor:`).

### Frontend (TypeScript/React)

*   **Style & Linting**: **Biome** is used for formatting and linting.
*   **React Practices**:
    *   The codebase exclusively uses **functional components and Hooks**.
    *   Custom Hooks (in `hooks.ts`) are heavily used to encapsulate stateful logic, such as version checking and theme synchronization.
    *   Logic is well-decoupled. For example, the `useNcmTheme` hook encapsulates theme logic, making the main `App` component cleaner.
*   **API Interaction**: Direct interaction with external APIs (like the client's Redux store) is abstracted away behind a dedicated adapter (`playerActions` object in `ReactStoreProvider.ts`). This centralizes API knowledge and makes the code resilient to upstream changes.
*   **Robustness over Convenience**: The project has evolved to systematically replace fragile implementation details (e.g., DOM manipulation, hardcoded paths to internal React properties) with more robust, future-proof strategies (e.g., dispatching Redux actions, recursively searching the Fiber tree).

### Backend (Rust)

*   **Style & Linting**: **Clippy** is used with strict rule sets (`pedantic`, `nursery`) enabled, indicating a high standard for idiomatic and safe Rust code.
*   **Logging**: The `tracing` crate is used for comprehensive, structured logging. Logs are piped to both a file and the frontend console, with dynamically configurable log levels.
*   **Safety**: While FFI necessitates `unsafe` code, its usage is localized. The project uses safe wrappers where possible.

### Testing & Validation

While the project lacks a formal automated testing suite, it follows a rigorous and pragmatic validation process:

1.  **Hypothesize**: Form a theory about how an internal API works.
2.  **Validate**: Write small, isolated scripts to test the hypothesis directly in the client's developer console.
3.  **Implement**: Only after the hypothesis is proven correct, integrate the new, validated logic into the main codebase.

This iterative, evidence-based approach is crucial when working with and reverse-engineering a closed-source application.