const path = require('path');

/**@type {import('webpack').Configuration}*/
module.exports = {
  target: 'web',
  mode: 'production',
  entry: './src/webview/assets/main.ts',
  output: {
    path: path.resolve(__dirname, 'dist/webview/assets'),
    filename: 'main.js',
    devtoolModuleFilenameTemplate: '../[resource-path]'
  },
  resolve: {
    extensions: ['.ts', '.js']
  },
  module: {
    rules: [
      {
        test: /\.ts$/,
        exclude: /node_modules/,
        use: [{ loader: 'ts-loader', options: { configFile: 'tsconfig.webview.json' } }]
      }
    ]
  },
  devtool: 'source-map',
  infrastructureLogging: { level: "log" },
};
