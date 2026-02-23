import { existsSync } from 'fs';
import { resolve } from 'path';

export default async function globalSetup(): Promise<void> {
  const mainEntry = resolve(__dirname, '../out/main/index.js');

  if (!existsSync(mainEntry)) {
    throw new Error(
      `Electron app not found at ${mainEntry}. Run "pnpm build" before running E2E tests.`,
    );
  }
}
