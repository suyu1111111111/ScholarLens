Page({
  data: {
    status: 'idle', // idle | authorizing | entering
  },

  onLoad() {
    const isLoggedIn = wx.getStorageSync('isLoggedIn');
    if (isLoggedIn) {
      wx.switchTab({ url: '/pages/index/index' });
    }
  },

  onLogin() {
    if (this.data.status !== 'idle') return;
    this.setData({ status: 'authorizing' });

    wx.getUserProfile({
      desc: '用于展示用户昵称和头像',
      success: (res) => {
        const userInfo = res.userInfo;
        wx.setStorageSync('userInfo', userInfo);
        wx.setStorageSync('isLoggedIn', true);
        const app = getApp();
        app.globalData.userInfo = userInfo;
        app.globalData.isLoggedIn = true;

        this.setData({ status: 'entering' });
        setTimeout(() => {
          wx.switchTab({ url: '/pages/index/index' });
        }, 400);
      },
      fail: () => {
        wx.setStorageSync('isLoggedIn', true);

        this.setData({ status: 'entering' });
        setTimeout(() => {
          wx.switchTab({ url: '/pages/index/index' });
        }, 400);
      },
    });
  },
});
