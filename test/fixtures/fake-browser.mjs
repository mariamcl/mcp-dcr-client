#!/usr/bin/env node
// Test-only "browser": given an OAuth authorization URL, follows it (no-redirect)
// then follows the Location header to drive the auto-approve flow.
import { get } from 'node:http';

const url = process.argv[2];
if (!url) process.exit(1);

function httpGet(target) {
  return new Promise((resolve, reject) => {
    const req = get(target, (res) => {
      res.resume(); // drain body
      resolve(res);
    });
    req.on('error', reject);
  });
}

async function main() {
  const res = await httpGet(url);
  const loc = res.headers['location'];
  if (loc) {
    await httpGet(loc);
  }
}

main().then(() => process.exit(0)).catch(() => process.exit(0));
