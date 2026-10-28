import { isValidElement } from 'react';
import type { ReactNode } from 'react';
import type { SceneNode } from './composition-scene';

// react-native-svg gradients clone each child, including null placeholders.
// Supply one children value, with only real elements for container nodes.
export function nativeSceneChildren(node: SceneNode, render: (child: SceneNode) => ReactNode): ReactNode {
  if (node.text !== undefined) return node.text;
  return node.children?.map(render).filter(isValidElement);
}
