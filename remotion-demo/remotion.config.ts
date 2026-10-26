import { Config } from '@remotion/cli/config';
import path from 'node:path';
import { existsSync } from 'node:fs';
Config.setVideoImageFormat('png');
Config.setColorSpace('bt709');
Config.setOverwriteOutput(true);
const chrome = 'C:/Program Files/Google/Chrome/Application/chrome.exe';
if (process.platform === 'win32' && existsSync(chrome)) Config.setBrowserExecutable(chrome);
Config.overrideWebpackConfig((config) => ({
  ...config,
  module: {
    ...config.module,
    rules: [
      ...(config.module?.rules ?? []),
      { test: /RelayaMark\.tsx$/, enforce: 'pre', use: path.resolve('scripts/remotion-assets-loader.cjs') },
    ],
  },
  resolve: {
    ...config.resolve,
    extensionAlias: { '.js': ['.ts', '.tsx', '.js'] },
    alias: {
      ...config.resolve?.alias,
      react: path.resolve('node_modules/react'),
      'react-dom': path.resolve('node_modules/react-dom'),
    },
  },
}));
