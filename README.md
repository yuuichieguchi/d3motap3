# d3motap3

A macOS desktop app for creating developer demo videos. Compose multiple capture sources into a single recording, automate terminal workflows with YAML scripts, and generate narration with AI.

## Features

- **Multi-Source Recording** — Capture from displays, application windows, webcams, terminals, and mobile devices (Android via scrcpy, iOS via CoreMediaIO) simultaneously. macOS only.
- **Composite Layouts** — Arrange sources in Single, Side-by-Side, Picture-in-Picture, or Zoomed layouts with adjustable parameters.
- **Terminal Capture** — Built-in PTY-based terminal emulation (alacritty_terminal + cosmic-text) with interactive input and theming support. The terminal is a first-class capture source rendered entirely in Rust.
- **Scripted Automation** — Define recording workflows in YAML scripts to automate terminal input, wait for output patterns, zoom, add captions, and switch layouts. Scripts currently support terminal sources only.
- **AI Integration** — Generate narration text and YAML recording scripts from video descriptions using the Anthropic API (Claude).
- **FFmpeg Encoding** — Encode recordings to MP4 (H.264) or WebM (VP9) via FFmpeg subprocess with raw frame piping.

## Tech Stack

| Layer | Technology |
|---|---|
| Desktop Shell | Electron 40 |
| Frontend | React 19, Zustand 5, TypeScript 5 |
| Build System | electron-vite 2, pnpm workspaces |
| Native Core | Rust (napi-rs), ScreenCaptureKit (macOS) |
| Testing | Playwright (E2E) |

## Project Structure

```
d3motap3/
  packages/
    app/        # Electron application (React + TypeScript)
    core/       # Rust native module via napi-rs
    shared/     # Shared TypeScript type definitions
```

## Prerequisites

- macOS (ScreenCaptureKit required)
- Node.js >= 20
- pnpm >= 10
- Rust (stable toolchain)
- FFmpeg (available in PATH)
- scrcpy (for Android device capture, optional)

## Getting Started

```bash
# Install dependencies
pnpm install

# Build the native Rust module
cd packages/core && pnpm build && cd ../..

# Start the development server
pnpm dev

# Build for production
pnpm build
```

## Testing

```bash
# Run E2E tests (requires a production build)
cd packages/app
pnpm build
pnpm test:e2e
```

## License

[MIT](LICENSE)
