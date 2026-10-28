const { withAndroidManifest, withAppBuildGradle } = require('expo/config-plugins');
module.exports = config => {
  config = withAppBuildGradle(config, value => {
    const marker = '// PopOut: shorten native object paths on Windows';
    if (!value.modResults.contents.includes(marker)) value.modResults.contents += `
${marker}
android { defaultConfig { externalNativeBuild { cmake { arguments "-DCMAKE_OBJECT_PATH_MAX=240" } } } }
`;
    return value;
  });
  return withAndroidManifest(config, value => {
  const manifest = value.modResults.manifest;
  manifest.$['xmlns:tools'] = 'http://schemas.android.com/tools';
  const app = manifest.application[0];
  app['meta-data'] ||= [];
  const name = 'com.google.mlkit.vision.DEPENDENCIES';
  let entry = app['meta-data'].find(item => item.$?.['android:name'] === name);
  if (!entry) { entry = { $: { 'android:name': name } }; app['meta-data'].push(entry); }
  const dependencies = new Set((entry.$['android:value'] || '').split(',').filter(Boolean));
  // Preserve the development launcher QR model; subject inference is bundled and CPU-only.
  dependencies.add('barcode_ui'); dependencies.delete('subject_segment');
  entry.$['android:value'] = [...dependencies].join(',');
  entry.$['tools:replace'] = 'android:value';
  return value;
  });
};
