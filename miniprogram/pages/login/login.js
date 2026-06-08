Page({
  data: {
    nickname: '',
  },

  onLoad() {
    const isLoggedIn = wx.getStorageSync('isLoggedIn');
    if (isLoggedIn) {
      wx.switchTab({ url: '/pages/index/index' });
    }
  },

  onNickInput(e) {
    this.setData({ nickname: e.detail.value.trim() });
  },

  onEnter() {
    const nickname = this.data.nickname || '学者';
    const userInfo = { nickName: nickname, avatarUrl: '' };
    wx.setStorageSync('userInfo', userInfo);
    wx.setStorageSync('isLoggedIn', true);
    const app = getApp();
    app.globalData.userInfo = userInfo;
    app.globalData.isLoggedIn = true;
    wx.switchTab({ url: '/pages/index/index' });
  },
});
