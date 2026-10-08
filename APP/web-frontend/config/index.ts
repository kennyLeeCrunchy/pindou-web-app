import { defineConfig, type UserConfigExport } from '@tarojs/cli'
import devConfig from './dev'
import prodConfig from './prod'

export default defineConfig<'webpack5'>(async (merge, { mode }) => {
  const baseConfig: UserConfigExport<'webpack5'> = {
    projectName: 'pindou-web-frontend',
    date: '2026-08-11',
    designWidth: 750,
    deviceRatio: {
      375: 2,
      640: 1.17,
      750: 1,
      828: 0.905,
    },
    sourceRoot: 'src',
    outputRoot: 'dist',
    framework: 'react',
    compiler: 'webpack5',
    cache: { enable: true },
    h5: {
      publicPath: '/',
      router: { mode: 'hash' },
      devServer: {
        host: '127.0.0.1',
        port: 5181,
        proxy: [{ context: ['/api'], target: 'http://127.0.0.1:5188' }],
      },
      htmlPluginOption: { title: '拼豆助手 · 本地版' },
      postcss: {
        pxtransform: { enable: true, config: {} },
        url: { enable: true },
        cssModules: { enable: false },
      },
    },
  }

  return merge({}, baseConfig, mode === 'development' ? devConfig : prodConfig)
})
