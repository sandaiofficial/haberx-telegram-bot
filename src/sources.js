export const sources = [
  {
    name: "Anadolu Ajansı",
    home: "https://www.aa.com.tr/tr",
    language: "tr",
    limit: 30,
    include: /^https:\/\/(?:www\.)?aa\.com\.tr\/tr\/[^?#]+\/\d+$/i
  },
  {
    name: "TRT Haber",
    home: "https://www.trthaber.com/son-dakika-haberleri",
    language: "tr",
    limit: 30,
    include: /^https:\/\/(?:www\.)?trthaber\.com\/haber\/[^?#]+\/\d+\.html$/i
  },
  {
    name: "NTV",
    home: "https://www.ntv.com.tr/son-dakika",
    language: "tr",
    limit: 30,
    include: /^https:\/\/(?:www\.)?ntv\.com\.tr\/[^?#]+,[A-Za-z0-9_-]+$/i
  },
  {
    name: "CNN Türk",
    home: "https://www.cnnturk.com/son-dakika",
    language: "tr",
    limit: 30,
    include: /^https:\/\/(?:www\.)?cnnturk\.com\/(?:turkiye|dunya|ekonomi|spor|magazin|teknoloji|saglik|yerel-haberler)\/[^?#]+$/i
  },
  {
    name: "Habertürk",
    home: "https://www.haberturk.com/son-dakika-haberleri",
    language: "tr",
    limit: 30,
    include: /^https:\/\/(?:www\.)?haberturk\.com\/[^?#]+-\d+$/i
  },
  {
    name: "Sözcü",
    home: "https://www.sozcu.com.tr/son-dakika",
    language: "tr",
    limit: 30,
    include: /^https:\/\/(?:www\.)?sozcu\.com\.tr\/[^?#]+-p\d+$/i
  },
  {
    name: "Cumhuriyet",
    home: "https://www.cumhuriyet.com.tr/son-dakika",
    language: "tr",
    limit: 30,
    include: /^https:\/\/(?:www\.)?cumhuriyet\.com\.tr\/[^?#]+\/[^/?#]+-\d+$/i
  },
  {
    name: "DHA",
    home: "https://www.dha.com.tr/son-dakika",
    language: "tr",
    limit: 30,
    include: /^https:\/\/(?:www\.)?dha\.com\.tr\/(?:gundem|politika|spor|dunya|ekonomi|egitim|saglik-yasam|yerel-haberler)\/[^?#]+-\d+$/i
  },
  {
    name: "T24",
    home: "https://t24.com.tr/son-dakika",
    language: "tr",
    limit: 30,
    include: /^https:\/\/(?:www\.)?t24\.com\.tr\/haber\/[^?#]+,\d+$/i
  },
  {
    name: "BBC World",
    home: "https://www.bbc.com/news/world",
    language: "en",
    limit: 25,
    include: /^https:\/\/(?:www\.)?bbc\.com\/news\/(?:articles\/[a-z0-9]+|[^?#]+)$/i
  },
  {
    name: "Reuters World",
    home: "https://www.reuters.com/world/",
    language: "en",
    limit: 25,
    include: /^https:\/\/(?:www\.)?reuters\.com\/world\/[^?#]+\/\d{4}-\d{2}-\d{2}\/?$/i
  },
  {
    name: "AP World",
    home: "https://apnews.com/world-news",
    language: "en",
    limit: 25,
    include: /^https:\/\/apnews\.com\/article\/[^?#]+-[a-f0-9]{20,}$/i
  },
  {
    name: "DW English",
    home: "https://www.dw.com/en/top-stories/s-9097",
    language: "en",
    limit: 25,
    include: /^https:\/\/(?:www\.)?dw\.com\/en\/[^?#]+\/a-\d+$/i
  },
  {
    name: "France 24",
    home: "https://www.france24.com/en/",
    language: "en",
    limit: 25,
    include: /^https:\/\/(?:www\.)?france24\.com\/en\/(?:africa|americas|asia-pacific|europe|france|middle-east)\/[^?#]+$/i
  },
  {
    name: "Al Jazeera English",
    home: "https://www.aljazeera.com/news/",
    language: "en",
    limit: 25,
    include: /^https:\/\/(?:www\.)?aljazeera\.com\/news\/\d{4}\/\d{1,2}\/\d{1,2}\/[^?#]+$/i
  }
];
