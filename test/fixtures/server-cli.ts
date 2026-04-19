import { startServer } from './server.js';
import { parseArgs } from 'node:util';

const { values } = parseArgs({
  options: {
    port: { type: 'string', default: '3030' },
    'auto-approve': { type: 'boolean', default: false },
  },
});

const port = Number(values.port);
const autoApprove = Boolean(values['auto-approve']);
const srv = await startServer({ port, autoApprove });
console.log(`Fixture server listening at ${srv.baseUrl}`);
console.log(`Mode: ${autoApprove ? 'auto-approve' : 'interactive'}`);
