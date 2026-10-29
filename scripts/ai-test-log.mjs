import {experimentRoot,readTestRecords} from '../server/experiment-log.mjs';
import {renderTestLog} from './render-ai-test-log.mjs';
const summary=await renderTestLog(experimentRoot,await readTestRecords(experimentRoot));
console.log(JSON.stringify({folder:experimentRoot,...summary}));
