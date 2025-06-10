const path = require('path');
const CopyPlugin = require('copy-webpack-plugin');
const { CleanWebpackPlugin } = require('clean-webpack-plugin');

module.exports = (env, argv) => {
  const isProduction = argv.mode === 'production';
  
  return {
    mode: isProduction ? 'production' : 'development',
    devtool: isProduction ? 'source-map' : 'eval-source-map',
    entry: {
      content: './src/content.js',
      background: './src/background.js',
      options: './src/options.js',
      popup: './src/popup.js',
      offscreen: './src/offscreen.js'
    },
    output: {
      path: path.resolve(__dirname, 'dist'),
      filename: (pathData) => {
        // Output background.js and offscreen.js without .bundle suffix
        if (['background', 'offscreen'].includes(pathData.chunk.name)) {
          return '[name].js';
        }
        return '[name].bundle.js';
      },
      clean: true
    },
    module: {
      rules: [
        {
          test: /\.js$/,
          exclude: /node_modules/,
          use: {
            loader: 'babel-loader',
            options: {
              presets: ['@babel/preset-env'],
              cacheDirectory: true
            }
          }
        }
      ]
    },
    optimization: {
      minimize: isProduction,
      moduleIds: 'deterministic',
      splitChunks: {
        cacheGroups: {
          vendor: {
            test: /[\\/]node_modules[\\/]/,
            name: 'vendors',
            chunks: 'all'
          }
        }
      }
    },
    plugins: [
      new CleanWebpackPlugin(),
      new CopyPlugin({
        patterns: [
          { from: 'manifest.json', to: '.' },
          { from: 'src/*.html', to: '[name][ext]' },
          { from: 'icons', to: 'icons' },
          { from: 'src/audio-worklet.js', to: '.' }
        ]
      })
    ],
    watchOptions: {
      ignored: /node_modules/,
      aggregateTimeout: 300
    },
    cache: {
      type: 'filesystem',
      buildDependencies: {
        config: [__filename]
      }
    }
  };
};