const path = require('path');
const CopyWebpackPlugin = require('copy-webpack-plugin');

/**@type {import('webpack').Configuration}*/
const config = {
  target: 'node', // VS Code extensions run in a Node.js-context
  mode: 'production', // This leaves the source code as close as possible to the original

  entry: './src/extension.ts', // The entry point of this extension
  output: {
    // The bundle is stored in the 'dist' folder (check package.json)
    path: path.resolve(__dirname, 'dist'),
    filename: 'extension.js',
    libraryTarget: 'commonjs2',
    clean: true // Clean the output directory before emit
  },
  externals: {
    vscode: 'commonjs vscode' // The vscode-module is created on-the-fly and must be excluded
  },
  resolve: {
    // Support reading TypeScript and JavaScript files
    extensions: ['.ts', '.js']
  },
  module: {
    rules: [
      {
        test: /\.ts$/,
        exclude: /node_modules/,
        use: [
          {
            loader: 'ts-loader'
          }
        ]
      }
    ]
  },
  plugins: [
    // Copy webview assets to dist folder
    new CopyWebpackPlugin({
      patterns: [
        {
          from: path.resolve(__dirname, 'src/webview/assets'),
          to: path.resolve(__dirname, 'dist/webview/assets'),
          noErrorOnMissing: true
        },
        {
          from: path.resolve(__dirname, 'src/utils/templates'),
          to: path.resolve(__dirname, 'dist/utils/templates'),
          noErrorOnMissing: true
        }
      ]
    })
  ],
  devtool: 'source-map',
  infrastructureLogging: {
    level: "log", // Enables logging required for problem matchers
  },
};

module.exports = config;
