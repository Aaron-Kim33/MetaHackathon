import { requireOptionalNativeModule } from 'expo-modules-core';
export const spatialRendererAvailable = () => !!requireOptionalNativeModule('ExpoGL');
