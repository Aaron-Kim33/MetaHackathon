import React, { memo, useMemo } from 'react';
import { Image } from 'react-native';
import type { ImageProps } from 'react-native';
export const CachedImage = memo(function CachedImage({ data, ...props }: Omit<ImageProps, 'source'> & { data: string }) {
  const source = useMemo(() => ({ uri: `data:image/png;base64,${data}` }), [data]);
  return <Image {...props} source={source} fadeDuration={0} />;
});
