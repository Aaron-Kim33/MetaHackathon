import test from 'node:test';
import assert from 'node:assert/strict';
import { editorLayout, fitCanvas } from '../src/editor-layout.ts';

test('photo ratios fit the fixed editor viewport without cropping or hiding controls', () => {
  for (const [width, height] of [[320, 520], [360, 640], [390, 760], [430, 850]]) {
    for (const panelOpen of [false, true]) {
      const editor = editorLayout(height, panelOpen, false);
      assert.equal(editor.stageHeight, height);
      assert.deepEqual(fitCanvas(width, editor.stageHeight, 4 / 5, editor.showRail), fitCanvas(width, editorLayout(height, !panelOpen, false).stageHeight, 4 / 5, false), 'opening tools must not resize or shift the canvas');
      if (editor.showRail) assert.ok(editor.railButtonHeight * 7 + 36 <= editor.stageHeight);
      for (const ratio of [4 / 5, 9 / 16, 1, 3 / 4, 3 / 1]) {
        const canvas = fitCanvas(width, editor.stageHeight, ratio, editor.showRail);
        assert.ok(canvas.width <= width + 1e-6);
        assert.equal(canvas.railWidth, 0);
        assert.ok(canvas.height <= editor.stageHeight + 1e-6);
        assert.ok(Math.abs(canvas.width / canvas.height - ratio) < 1e-6);
      }
    }
  }
});

test('keyboard resize hides the side rail while leaving room for the canvas and active panel', () => {
  for (const height of [280, 360, 440]) {
    const editor = editorLayout(height, true, true);
    assert.equal(editor.showRail, false);
    assert.ok(editor.stageHeight >= 56);
    assert.equal(editor.panelHeight, Math.min(110, height * 0.225));
    assert.equal(editor.stageHeight, height);
    assert.ok(editor.panelHeight < height);
    const canvas = fitCanvas(360, editor.stageHeight, 9 / 16, editor.showRail);
    assert.ok(canvas.width > 0 && canvas.height > 0);
  }
  assert.deepEqual(fitCanvas(0, 0, 0, false), { width: 0, height: 0, railWidth: 0 });
});
