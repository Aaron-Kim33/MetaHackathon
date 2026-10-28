import test from 'node:test';
import assert from 'node:assert/strict';
import React from 'react';
import { nativeSceneChildren } from '../src/native-scene-children.ts';
import { buildCompositionScene } from '../src/composition-scene.ts';
import { settings } from '../server/composition.mjs';

// This is the React child-cloning contract used by react-native-svg's extractGradient.
const cloneStops = children => React.Children.map(children, child => React.cloneElement(child, { parent: 'gradient' }));
test('photo scenes never pass null placeholders to native gradient child cloning', () => {
  for (const mode of ['plain', 'frame', 'sticker']) {
    const scene = buildCompositionScene({ source: { width: 800, height: 1200 }, subject: false, shadow: false, stickers: [] }, settings({ mode }));
    const gradients = scene.defs.filter(n => n.type === 'linearGradient' || n.type === 'radialGradient');
    assert.ok(gradients.length > 0);
    for (const gradient of gradients) {
      const render = node => React.createElement('Stop', { key: node.key, ...node.attrs });
      const broken = React.createElement('Gradient', null, gradient.text, gradient.children.map(render));
      assert.throws(() => cloneStops(broken.props.children), /React element/);
      const fixed = React.createElement('Gradient', null, nativeSceneChildren(gradient, render));
      const cloned = cloneStops(fixed.props.children);
      assert.equal(cloned.length, gradient.children.length);
      assert.ok(cloned.every(React.isValidElement));
    }
  }
});
test('missing image assets are omitted and text stays a single string child', () => {
  const group = { key: 'group', type: 'g', attrs: {}, children: [{ key: 'missing', type: 'image', attrs: {} }, { key: 'present', type: 'image', attrs: {} }] };
  const children = nativeSceneChildren(group, node => node.key === 'missing' ? null : React.createElement('Image', { key: node.key }));
  assert.equal(children.length, 1); assert.ok(React.isValidElement(children[0]));
  assert.equal(nativeSceneChildren({ key: 'label', type: 'text', attrs: {}, text: '9:41' }, () => null), '9:41');
});
