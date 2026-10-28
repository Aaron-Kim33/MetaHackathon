import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
test('Metro excludes native builds and private media while allowing app source, with compatible regex flags', () => {
  const config = require('../metro.config.cjs'), rules = config.resolver.blockList;
  assert.equal(new Set(rules.map(rule => rule.flags)).size, 1, 'Expo must be able to combine all exclusion patterns');
  const blocked = file => rules.some(rule => rule.test(path.resolve(file)));
  for (const file of ['.local/projects/example/source.png', '.local/export/android/index.hbc', 'android/app/.cxx/build.ninja', 'ios/Pods/source.h', 'modules/subject-lift/android/build/generated/R.java', 'modules/subject-lift/android/src/main/assets/interactive_segmentation.task']) assert.equal(blocked(file), true, file);
  for (const file of ['App.tsx', 'src/device-cutout.ts', 'src/CompositionCanvas.tsx', 'node_modules/react-native-svg/src/ReactNativeSVG.ts']) assert.equal(blocked(file), false, file);
});
