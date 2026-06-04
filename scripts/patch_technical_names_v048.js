/** 一次性修正 technical-data.json 英文名稱 → 中文（v0.4.8） */
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const FILES = [
  path.join(ROOT, 'technical-data.json'),
  path.join(ROOT, 'docs', 'technical-data.json'),
  path.join(ROOT, 'site', 'technical-data.json'),
];

const NAME_MAP = {
  '1409': '新纖',
  '1568': '倉佑',
  '2059': '川湖',
  '2061': '風青',
  '2303': '聯電',
  '2308': '台達電',
  '2313': '華通',
  '2344': '華邦電',
  '2345': '智邦',
  '2356': '英業達',
  '2360': '致茂',
  '2379': '瑞昱',
  '2383': '台光電',
  '2455': '全新',
  '2492': '華新',
  '2495': '普安',
  '3008': '大立光',
  '3017': '奇鋐',
  '3021': '鴻名',
  '3026': '禾伸堂',
  '3034': '聯詠',
  '3149': '正達',
  '3481': '群創',
  '3528': '安馳',
  '3556': '禾瑞亞',
  '3624': '光寶科',
  '4958': '臻鼎-KY',
  '5274': '信驊',
  '5321': '美而快',
  '5864': '致和證',
  '6005': '群益證',
  '6015': '宏遠證',
  '6016': '康和證',
  '6116': '華映',
  '6127': '九豪',
  '6197': '佳必琪',
  '6207': '雷科',
  '6223': '旺矽',
  '6239': '力成',
  '6285': '啟碁',
  '6415': '矽力*-KY',
  '6515': '穩懋',
  '6548': '長華科',
  '6654': '羅昇',
  '6870': '騰雲',
  '7769': '宏碩系統',
  '8043': '蜜望實',
  '9105': '泰金寶-DR',
};

const EN = /[A-Za-z]{4,}/;

FILES.forEach(function (file) {
  const data = JSON.parse(fs.readFileSync(file, 'utf8'));
  let n = 0;
  data.records.forEach(function (r) {
    const zh = NAME_MAP[r.code];
    if (zh) {
      if (r.name !== zh) n++;
      r.name = zh;
    }
  });
  const remaining = data.records.filter(function (r) {
    return EN.test(r.name || '') && !/[\u4e00-\u9fff]/.test(r.name || '');
  });
  fs.writeFileSync(file, JSON.stringify(data, null, 2) + '\n', 'utf8');
  console.log(file, 'updated', n, 'remaining_english_only', remaining.length);
  remaining.forEach(function (r) {
    console.log('  uncertain:', r.code, r.name);
  });
});
