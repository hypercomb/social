import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'io.hypercom.app',
  appName: 'Hypercomb',
  webDir: 'www',
  server: {
    url: 'https://hypercomb.io',
    allowNavigation: [
      'hypercomb.io',
      'hypercom.io',
      'meadowverse.ca',
      'diamondcoreprocessor.com',
      'hypercomb.com',
    ],
  },
  android: {
    backgroundColor: '#000000',
  },
};

export default config;
