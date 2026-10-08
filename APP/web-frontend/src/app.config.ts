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
  lazyCodeLoading: 'requiredComponents',
})
