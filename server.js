const express = require('express');
const axios = require('axios');
const cheerio = require('cheerio');
const cors = require('cors');

const app = express();
app.use(cors());

// ============================================================
// GIÁ DỰ PHÒNG — cập nhật thủ công khi server không crawl được
// Hiệu lực: 00h00 ngày 27/03/2026
// ============================================================
const FALLBACK = {
  e5:       23320,
  ron95:    24330,
  diesel:   35440,
  kerosene: 35380,
  mazut:    21740,
  source:   'fallback',
  updatedAt: new Date('2026-03-27T00:00:00+07:00')
};

let fuelData = { ...FALLBACK };

// ============================================================
// NGUỒN 1: giaxangdau.net
// ============================================================
async function fetchFromGiaxangdauNet() {
  const { data } = await axios.get('https://giaxangdau.net/', {
    timeout: 10000,
    headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)' }
  });
  const $ = cheerio.load(data);

  let e5 = 0, ron95 = 0, diesel = 0, kerosene = 0;

  // Thử nhiều cách selector khác nhau
  $('table tr, .price-table tr, .bang-gia tr').each((_, row) => {
    const cells = $(row).find('td');
    if (cells.length < 2) return;
    const label = $(cells[0]).text().trim();
    const rawVal = $(cells[1]).text().trim();
    const val = parseInt(rawVal.replace(/[^0-9]/g, ''));
    if (!val || val < 10000 || val > 100000) return;

    if (/E5|RON\s*92/i.test(label) && !e5) e5 = val;
    else if (/RON\s*95/i.test(label) && !ron95) ron95 = val;
    else if (/[Dd]iesel|[Dd]ầu\s*[Dd]iesel/i.test(label) && !diesel) diesel = val;
    else if (/[Hh]ỏa|[Kk]erosene/i.test(label) && !kerosene) kerosene = val;
  });

  // Fallback: tìm text chứa giá trong toàn bộ trang
  if (!e5 || !ron95) {
    const bodyText = $.text();
    const matchE5  = bodyText.match(/E5[^0-9]*([0-9]{5,6})/);
    const match95  = bodyText.match(/RON\s*95[^0-9]*([0-9]{5,6})/);
    const matchDsl = bodyText.match(/[Dd]iesel[^0-9]*([0-9]{5,6})/);
    if (matchE5  && !e5)      e5      = parseInt(matchE5[1]);
    if (match95  && !ron95)   ron95   = parseInt(match95[1]);
    if (matchDsl && !diesel)  diesel  = parseInt(matchDsl[1]);
  }

  if (!e5 || !ron95) throw new Error('Không parse được giá từ giaxangdau.net');
  return { e5, ron95, diesel: diesel || fuelData.diesel, kerosene: kerosene || fuelData.kerosene };
}

// ============================================================
// NGUỒN 2: xangdau.net
// ============================================================
async function fetchFromXangdauNet() {
  const { data } = await axios.get('https://xangdau.net/', {
    timeout: 10000,
    headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)' }
  });
  const $ = cheerio.load(data);

  let e5 = 0, ron95 = 0, diesel = 0, kerosene = 0;

  $('table tr').each((_, row) => {
    const cells = $(row).find('td');
    if (cells.length < 2) return;
    const label = $(cells[0]).text().trim();
    const rawVal = $(cells[1]).text().trim();
    const val = parseInt(rawVal.replace(/[^0-9]/g, ''));
    if (!val || val < 10000 || val > 100000) return;

    if (/E5|RON\s*92/i.test(label) && !e5) e5 = val;
    else if (/RON\s*95/i.test(label) && !ron95) ron95 = val;
    else if (/[Dd]iesel/i.test(label) && !diesel) diesel = val;
    else if (/[Hh]ỏa/i.test(label) && !kerosene) kerosene = val;
  });

  if (!e5 || !ron95) throw new Error('Không parse được giá từ xangdau.net');
  return { e5, ron95, diesel: diesel || fuelData.diesel, kerosene: kerosene || fuelData.kerosene };
}

// ============================================================
// HÀM CHÍNH: thử lần lượt từng nguồn
// ============================================================
async function fetchFuel() {
  const sources = [
    { name: 'giaxangdau.net', fn: fetchFromGiaxangdauNet },
    { name: 'xangdau.net',    fn: fetchFromXangdauNet },
  ];

  for (const src of sources) {
    try {
      const prices = await src.fn();

      // Kiểm tra giá hợp lệ (tránh parse ra số rác)
      if (prices.e5 < 15000 || prices.e5 > 80000) throw new Error('Giá E5 bất thường: ' + prices.e5);
      if (prices.ron95 < 15000 || prices.ron95 > 80000) throw new Error('Giá RON95 bất thường: ' + prices.ron95);

      fuelData = {
        e5:       prices.e5,
        ron95:    prices.ron95,
        diesel:   prices.diesel,
        kerosene: prices.kerosene,
        mazut:    fuelData.mazut,
        source:   src.name,
        updatedAt: new Date()
      };

      console.log(`[${new Date().toLocaleString('vi-VN')}] ✅ Cập nhật từ ${src.name}:`, {
        E5: prices.e5, RON95: prices.ron95, Diesel: prices.diesel
      });
      return; // thành công, dừng lại

    } catch (err) {
      console.warn(`[${new Date().toLocaleString('vi-VN')}] ⚠️  ${src.name} thất bại: ${err.message}`);
    }
  }

  // Tất cả nguồn đều lỗi → giữ nguyên dữ liệu cũ
  console.warn(`[${new Date().toLocaleString('vi-VN')}] ❌ Tất cả nguồn thất bại, giữ giá cũ (${fuelData.source})`);
}

// Cập nhật ngay khi khởi động, sau đó mỗi 30 phút
fetchFuel();
setInterval(fetchFuel, 30 * 60 * 1000);

// ============================================================
// API ENDPOINTS
// ============================================================
app.get('/api/fuel', (req, res) => {
  res.json(fuelData);
});

// Endpoint kiểm tra sức khỏe
app.get('/api/health', (req, res) => {
  res.json({ ok: true, lastUpdate: fuelData.updatedAt, source: fuelData.source });
});

app.listen(PORT, '0.0.0.0', () => {
  console.log(`🚀 Server đang chạy tại Port: ${PORT}`);
  console.log('   GET /api/fuel    — giá xăng dầu hiện tại');
  console.log('   GET /api/health  — trạng thái server');
});