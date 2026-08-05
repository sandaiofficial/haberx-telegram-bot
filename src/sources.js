    name: "DHA",
    home: "https://www.dha.com.tr/",
    feeds: [],
    include: /^https:\/\/(www\.)?dha\.com\.tr\/(gundem|politika|spor|dunya|ekonomi|egitim|saglik-yasam)\/.+-\d+$/i
  },
  {
    name: "T24",
    home: "https://t24.com.tr/son-dakika",
    feeds: [],
    include: /^https:\/\/(www\.)?t24\.com\.tr\/haber\/.+,\d+$/i
  },
  {
    name: "TRT Haber",
    home: "https://www.trthaber.com/son-dakika-haberleri",
    feeds: ["https://www.trthaber.com/manset_articles.rss"],
    include: /^https:\/\/(www\.)?trthaber\.com\/haber\/.+\/\d+\.html$/i
  },
  {
    name: "soL Haber",
    home: "https://haber.sol.org.tr/",
    feeds: ["https://haber.sol.org.tr/rss.xml"],
    include: /^https:\/\/haber\.sol\.org\.tr\/haber\/.+-\d+$/i
  },
  {
    name: "Cumhuriyet",
    home: "https://www.cumhuriyet.com.tr/",
    feeds: ["https://www.cumhuriyet.com.tr/rss"],
    include: /^https:\/\/(www\.)?cumhuriyet\.com\.tr\/.+\/[^/]+-\d+$/i
  }
];

// İHA, sitesindeki kullanım şartları nedeniyle otomatik olarak etkin değildir.
// Yazılı kullanım/abonelik izniniz varsa aşağıdaki kaynağı sources dizisine ekleyebilirsiniz.
export const licensedOnlySources = [
  {
    name: "İHA",
    home: "https://www.iha.com.tr/tum-haberler",
    feeds: [],
    include: /^https:\/\/(www\.)?iha\.com\.tr\/(haber|gundem|politika|ekonomi|dunya|asayis|spor)\/.+/i
  }
