// LPFORGE_PHASE5_EXECUTION_MODULE
import { phase5Capabilities } from '../../../packages/config/src/index.js';
import { runPhase5DryRunFixture } from '../../../packages/execution-runtime/src/index.js';
const cmd=process.argv[2]??'capabilities';if(cmd==='capabilities')console.log(JSON.stringify(phase5Capabilities(),null,2));else if(cmd==='fixture-dry-run')console.log(JSON.stringify(await runPhase5DryRunFixture(),null,2));else{console.error('Usage: executor [capabilities|fixture-dry-run]');process.exitCode=2;}
