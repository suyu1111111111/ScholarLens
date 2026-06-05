Page({
  data: {
    profile: {
      nickname: '学者',
      avatarUrl: '',
      signature: '学而不思则罔，思而不学则殆',
    },
    stats: { readCount: 0, noteCount: 0 },
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
    this.fetchStats();
  },

  fetchStats() {
    const that = this;
    // 查论文数
    wx.cloud.callFunction({
      name: 'pdfSummary',
      data: { action: 'list' },
      success: (res) => {
        const count = (res.result && res.result.list) ? res.result.list.length : 0;
        that.setData({ 'stats.readCount': count, 'stats._readDone': true });
      },
      fail: () => { that.setData({ 'stats._readDone': true }); },
    });
    // 查笔记数
    wx.cloud.callFunction({
      name: 'pdfSummary',
      data: { action: 'noteList' },
      success: (res) => {
        const count = (res.result && res.result.list) ? res.result.list.length : 0;
        that.setData({ 'stats.noteCount': count });
      },
    });
  },

  onEditProfile() {
    wx.showModal({
      title: '修改昵称',
      editable: true,
      placeholderText: '请输入新昵称',
      success: (res) => {
        if (res.confirm && res.content) {
          this.setData({ 'profile.nickname': res.content });
          const userInfo = wx.getStorageSync('userInfo') || {};
          userInfo.nickName = res.content;
          wx.setStorageSync('userInfo', userInfo);
        }
      },
    });
  },

  onTapItem(e) {
    const key = e.currentTarget.dataset.key;
    switch (key) {
      case 'preference':
        this.onSetDefaultRole();
        break;
      case 'fontSize':
        wx.showToast({ title: '在阅读器中可调整字体', icon: 'none' });
        break;
      case 'exportNote':
        wx.switchTab({ url: '/pages/notes/index' });
        break;
      case 'paperManage':
        wx.switchTab({ url: '/pages/reader/reader' });
        break;
      case 'about':
        wx.showModal({
          title: '智阅深析',
          content: 'AI 驱动的学术论文精读助手\n\n支持 PDF 阅读、AI 摘要、标注笔记、思维导图等功能。',
          showCancel: false,
          confirmText: '知道了',
        });
        break;
      case 'feedback':
        wx.setClipboardData({
          data: '2308636309@qq.com',
          success: () => {
            wx.showToast({ title: '邮箱已复制，欢迎反馈', icon: 'none' });
          },
        });
        break;
    }
  },

  onSetDefaultRole() {
    const roles = ['学生（通俗讲解）', '研究者（深度分析）', '职场（商业洞察）'];
    wx.showActionSheet({
      itemList: roles,
      success: (res) => {
        const roleKeys = ['ben', 'alice', 'david'];
        wx.setStorageSync('defaultRole', roleKeys[res.tapIndex]);
        wx.showToast({ title: '默认角色已设为: ' + roles[res.tapIndex], icon: 'none' });
      },
    });
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
});
