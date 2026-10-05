export default defineAppConfig({
  pages: [
    'pages/home/index',
    'pages/convert/index',
    'pages/preview/index',
    'pages/editor/index',
    'pages/view/index',
    'pages/works/index',
    'pages/settings/index',
    'pages/privacy/index',
  ],
  window: {
    navigationBarBackgroundColor: '#fffaf3',
    navigationBarTextStyle: 'black',
    navigationBarTitleText: '拼豆助手',
    backgroundColor: '#fffaf3',
    backgroundTextStyle: 'dark',
  },
  tabBar: {
    custom: true,
    color: '#6c5346',
    selectedColor: '#fffdf8',
    backgroundColor: '#fff8f0',
    borderStyle: 'white',
    list: [
      { pagePath: 'pages/home/index', text: '首页' },
      { pagePath: 'pages/works/index', text: '作品' },
      { pagePath: 'pages/settings/index', text: '设置' },
    ],
  },
  lazyCodeLoading: 'requiredComponents',
})
