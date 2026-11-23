const { NxAppWebpackPlugin } = require('@nx/webpack/app-plugin');
const { join } = require('path');

module.exports = {
  output: {
    path: join(__dirname, '../../dist/apps/api'),
    clean: true,
    ...(process.env.NODE_ENV !== 'production' && {
      devtoolModuleFilenameTemplate: '[absolute-resource-path]',
    }),
  },
  plugins: [
    new NxAppWebpackPlugin({
      target: 'node',
      compiler: 'tsc',
      main: './src/main.ts',
      tsConfig: './tsconfig.app.json',
      assets: ['./src/assets'],
      // GH-370 T2: comando operado de backfill, empacotado ao lado do main.js
      // (a imagem de produção só tem o bundle, sem ts-node nem os fontes).
      additionalEntryPoints: [
        {
          entryName: 'backfill-ticket-description-text',
          entryPath: './src/tickets/backfill/backfill-ticket-description-text.cli.ts',
        },
      ],
      optimization: false,
      outputHashing: 'none',
      generatePackageJson: true,
      sourceMap: true,
    }),
  ],
};
