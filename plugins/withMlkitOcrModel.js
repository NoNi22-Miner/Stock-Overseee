// Ask Google Play services to download the on-device ML Kit models when the app is installed,
// so "scan words" works offline from the first use.
// expo-camera already declares this entry for its barcode model ("barcode_ui"); we declare both
// models and tell the manifest merger that our value wins.
const { AndroidConfig, withAndroidManifest } = require('expo/config-plugins');

const NAME = 'com.google.mlkit.vision.DEPENDENCIES';
const VALUE = 'barcode_ui,ocr';

module.exports = function withMlkitOcrModel(config) {
  return withAndroidManifest(config, (cfg) => {
    const manifest = cfg.modResults.manifest;
    manifest.$ = { ...manifest.$, 'xmlns:tools': 'http://schemas.android.com/tools' };
    const app = AndroidConfig.Manifest.getMainApplicationOrThrow(cfg.modResults);
    AndroidConfig.Manifest.addMetaDataItemToMainApplication(app, NAME, VALUE);
    const item = (app['meta-data'] ?? []).find((m) => m.$['android:name'] === NAME);
    if (item) item.$['tools:replace'] = 'android:value';
    return cfg;
  });
};
