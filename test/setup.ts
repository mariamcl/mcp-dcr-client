import type { TestProject } from 'vitest/node';
import { startServer, type FixtureServer } from './fixtures/server.js';

let server: FixtureServer | undefined;

export async function setup(project: TestProject) {
  server = await startServer({ autoApprove: true });
  project.provide('fixtureBaseUrl', server.baseUrl);
}

export async function teardown() {
  await server?.close();
}

declare module 'vitest' {
  export interface ProvidedContext {
    fixtureBaseUrl: string;
  }
}
