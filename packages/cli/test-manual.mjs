import { createOverrideCommand } from './dist/commands/override.js';

const cmd = createOverrideCommand();
// Parse with no --action
cmd.commands[0].parseAsync(['node', 'test', 'create', '-a', 'agt_1', '-t', 'fs.*'])
  .then(() => {
    console.log('Command parsed successfully (mocked API would have been called)');
  })
  .catch(e => {
    console.log('Error:', e.message);
  });
