Page({
  data: {
    profile: {
      nickname: '学者',
      avatarUrl: '',
      signature: '学而不思则罔，思而不学则殆',
    },
    stats: {
      readCount: 12,
      noteCount: 38,
      exportCount: 5,
    },
  },

  onShow() {
    if (typeof this.getTabBar === 'function' && this.getTabBar()) {
      this.getTabBar().setData({ selected: 3 });
    }
    const userInfo = wx.getStorageSync('userInfo');
    if (userInfo) {
      this.setData({
        'profile.nickname': userInfo.nickName || '学者',
        'profile.avatarUrl': userInfo.avatarUrl || '',
      });
    }
  },

  onEditProfile() {
    wx.showModal({
      title: '修改昵称',
      editable: true,
      placeholderText: '请输入新昵称',
      success: (res) => {
        if (res.confirm && res.content) {
          this.setData({ 'profile.nickname': res.content });
        }
      },
    });
  },

  onTapItem(e) {
    const key = e.currentTarget.dataset.key;
    wx.showToast({ title: key, icon: 'none' });
  },

  onLogout() {
    wx.showModal({
      title: '退出登录',
      content: '退出后需要重新授权登录',
      success: (res) => {
        if (res.confirm) {
          wx.removeStorageSync('isLoggedIn');
          wx.removeStorageSync('userInfo');
          const app = getApp();
          app.globalData.isLoggedIn = false;
          app.globalData.userInfo = null;
          wx.reLaunch({ url: '/pages/login/login' });
        }
      },
    });
  },
})
