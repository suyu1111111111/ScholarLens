// app.js
App({
  onLaunch: function () {
    this.globalData = {
      env: "cloud1-d7gomttv5c8fdacc9",
    };

    if (!wx.cloud) {
      console.error("请使用 2.2.3 或以上的基础库以使用云能力");
    } else {
      wx.cloud.init({
        env: this.globalData.env,
        traceUser: true,
      });
    }

    // 登录态校验：checkSession 失败则清除本地状态
    const isLoggedIn = wx.getStorageSync('isLoggedIn');
    if (isLoggedIn) {
      wx.checkSession({
        fail: () => {
          wx.removeStorageSync('isLoggedIn');
          wx.removeStorageSync('userInfo');
          this.globalData.isLoggedIn = false;
          this.globalData.userInfo = null;
        },
      });
    }
  },
});
