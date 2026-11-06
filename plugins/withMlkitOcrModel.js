// Ask Google Play services to download the on-device text-recognition (OCR) model when the app
// is installed, so "scan words" also works offline from the first use.
const { AndroidConfig, withAndroidManifest } = require('expo/config-plugins');

module.exports = function withMlkitOcrModel(config) {
  return withAndroidManifest(config, (cfg) => {
    const app = AndroidConfig.Manifest.getMainApplicationOrThrow(cfg.modResults);
    AndroidConfig.Manifest.addMetaDataItemToMainApplication(app, 'com.google.mlkit.vision.DEPENDENCIES', 'ocr');
    return cfg;
  });
};
