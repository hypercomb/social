import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'io.hypercom.app',
  appName: 'Hypercomb',
  webDir: 'www',
  server: {
    url: 'https://hypercom.io',
    allowNavigation: [
      'hypercom.io',
      'meadowverse.ca',
      'diamondcoreprocessor.com',
      'hypercomb.com',
    ],
  },
};

export default config;
