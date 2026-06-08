function formatDate(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  const now = new Date();
  const diff = now - d;
  if (diff < 86400000) return '今天';
  if (diff < 2 * 86400000) return '昨天';
  if (diff < 7 * 86400000) return Math.floor(diff / 86400000) + '天前';
  const m = d.getMonth() + 1;
  return m + '月' + d.getDate() + '日';
}

module.exports = { formatDate };
