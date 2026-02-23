# d3motap3

A developer-focused desktop application for creating multi-source screen recording videos with scripted automation and AI-powered narration.

## Features

- **Multi-Source Recording** — Capture from displays, application windows, webcams, terminals, and mobile devices (Android via ADB, iOS) simultaneously.
- **Composite Layouts** — Arrange sources in Single, Side-by-Side, or Picture-in-Picture layouts with adjustable parameters.
- **Terminal Capture** — Built-in PTY-based terminal emulation with interactive input and theming support.
- **Scripted Automation** — Define recording workflows in YAML scripts to automate typing, waiting, zooming, and scene transitions.
- **AI Integration** — Generate narration text and recording scripts from video descriptions using the Anthropic API.
- **FFmpeg Encoding** — Hardware-accelerated video encoding pipeline.

## Tech Stack

| Layer | Technology |
|---|---|
| Desktop Shell | Electron 33 |
| Frontend | React 19, Zustand, TypeScript |
| Build System | electron-vite, pnpm workspaces |
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

- Node.js >= 20
- pnpm >= 10
- Rust (stable toolchain)
- FFmpeg (available in PATH)
- macOS (primary platform, ScreenCaptureKit required)

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
