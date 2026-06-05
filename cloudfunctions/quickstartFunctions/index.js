const cloud = require("wx-server-sdk");
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });

const db = cloud.database();

// ========== 通用工具函数 ==========
const getOpenId = async () => {
  const wxContext = cloud.getWXContext();
  return { openid: wxContext.OPENID, appid: wxContext.APPID, unionid: wxContext.UNIONID };
};

const getMiniProgramCode = async () => {
  const resp = await cloud.openapi.wxacode.get({ path: "pages/index/index" });
  const { buffer } = resp;
  const upload = await cloud.uploadFile({ cloudPath: "code.png", fileContent: buffer });
  return upload.fileID;
};

// ========== 主入口 ==========
exports.main = async (event, context) => {
  switch (event.type) {
    case "getOpenId": return await getOpenId();
    case "getMiniProgramCode": return await getMiniProgramCode();
    default: return { success: false, errMsg: "未知操作: " + event.type };
  }
};
