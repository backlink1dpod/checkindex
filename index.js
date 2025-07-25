const TelegramBot = require('node-telegram-bot-api');
const axios = require('axios');
const express = require('express');
const fs = require('fs');
const { createObjectCsvWriter } = require('csv-writer');

const app = express();
app.use(express.json());

// Cấu hình bot Telegram
const TELEGRAM_TOKEN = process.env.TELEGRAM_TOKEN;
const WEBHOOK_URL = process.env.WEBHOOK_URL;
const bot = new TelegramBot(TELEGRAM_TOKEN);

// Thiết lập webhook
bot.setWebHook(`https://telegram-index-checker.onrender.com/webhook`);

// Danh sách API keys của SerpAPI
const apiKeys = [
  process.env.SERPAPI_KEY_1, // Key cũ
  process.env.SERPAPI_KEY_2  // Key mới
];
let currentApiKeyIndex = 0;

// Hàm kiểm tra quota của API key
async function checkApiQuota(apiKey) {
  try {
    console.log(`Checking quota for API key ${apiKey.slice(0, 10)}...`);
    const response = await axios.get(`https://serpapi.com/account.json?api_key=${apiKey}`);
    console.log(`Quota response for ${apiKey.slice(0, 10)}...: ${JSON.stringify(response.data)}`);
    if (response.data && typeof response.data.total_searches_left === 'number') {
      return response.data.total_searches_left;
    } else {
      console.error(`Invalid quota response for ${apiKey.slice(0, 10)}...: ${JSON.stringify(response.data)}`);
      return 0;
    }
  } catch (error) {
    console.error(`Error checking quota for ${apiKey.slice(0, 10)}...: ${error.message}, Status: ${error.response?.status}, Data: ${JSON.stringify(error.response?.data)}`);
    return 0;
  }
}

// Hàm chọn API key có quota
async function getNextApiKey() {
  const initialIndex = currentApiKeyIndex;
  for (let i = 0; i < apiKeys.length; i++) {
    const quota = await checkApiQuota(apiKeys[currentApiKeyIndex]);
    if (quota > 0) {
      console.log(`Using API key ${currentApiKeyIndex + 1} with ${quota} searches left`);
      return apiKeys[currentApiKeyIndex];
    }
    currentApiKeyIndex = (currentApiKeyIndex + 1) % apiKeys.length;
    console.log(`Switching to API key ${currentApiKeyIndex + 1}`);
  }
  throw new Error('Hết token');
}

// Hàm kiểm tra index của một URL
async function checkIndex(url, apiKey) {
  try {
    console.log(`Checking index for ${url} with API key ${apiKey.slice(0, 10)}...`);
    const response = await axios.get('https://serpapi.com/search.json', {
      params: {
        q: url,
        api_key: apiKey,
        num: 10
      }
    });
    const results = response.data.organic_results || [];
    const cleanUrl = (link) => {
      let firstUrl = link.trim().split('://')[1] || link;
      if (firstUrl.includes('?')) firstUrl = firstUrl.split('?')[0];
      firstUrl = firstUrl.replace('www.', '').replace(/\/+$/, '').toLowerCase();
      return firstUrl;
    };
    const lst_link = results.map(result => cleanUrl(result.link));
    const isIndex = lst_link.includes(cleanUrl(url));
    console.log(`Checked index for ${url}: ${isIndex ? 'Indexed' : 'Not Indexed'}`);
    return { url, isIndex, status: response.status };
  } catch (error) {
    console.error(`Error checking index for ${url}: ${error.message}, Status: ${error.response?.status}, Data: ${JSON.stringify(error.response?.data)}`);
    return { url, isIndex: false, status: 'Error' };
  }
}

// Hàm tạo và gửi file CSV
async function createAndSendCsv(chatId, results) {
  const csvWriter = createObjectCsvWriter({
    path: 'results.csv',
    header: [
      { id: 'url', title: 'URL' },
      { id: 'status', title: 'Status' }
    ]
  });

  const records = results.map(result => ({
    url: result.url,
    status: result.isIndex ? 'Indexed' : 'Not Indexed'
  }));

  await csvWriter.writeRecords(records);
  await bot.sendDocument(chatId, 'results.csv');
  fs.unlinkSync('results.csv'); // Xóa file sau khi gửi
}

// Webhook endpoint
app.post('/webhook', (req, res) => {
  console.log('Received webhook request');
  bot.processUpdate(req.body);
  res.sendStatus(200);
});

// Xử lý tin nhắn từ người dùng
bot.onText(/\/start/, (msg) => {
  const chatId = msg.chat.id;
  console.log(`Received /start from chat ${chatId}`);
  bot.sendMessage(chatId, 'Gửi danh sách URL (mỗi URL trên một dòng) hoặc tải lên file .txt chứa danh sách URL để kiểm tra index.');
});

// Xử lý lệnh /quota
bot.onText(/\/quota/, async (msg) => {
  const chatId = msg.chat.id;
  console.log(`Received /quota from chat ${chatId}`);
  const currentKey = apiKeys[currentApiKeyIndex];
  const quota = await checkApiQuota(currentKey);
  bot.sendMessage(chatId, `API Key ${currentApiKeyIndex + 1}: ${quota} searches left`);
});

// Xử lý tin nhắn chứa URL
bot.on('text', async (msg) => {
  const chatId = msg.chat.id;
  console.log(`Received text from chat ${chatId}: ${msg.text}`);
  if (msg.text.startsWith('/')) return;

  const urls = msg.text.split('\n').map(url => url.trim()).filter(url => url);
  if (urls.length === 0) {
    bot.sendMessage(chatId, 'Vui lòng gửi ít nhất một URL hợp lệ.');
    return;
  }

  bot.sendMessage(chatId, `Đang kiểm tra ${urls.length} URL...`);

  const results = [];
  for (const url of urls) {
    try {
      const apiKey = await getNextApiKey();
      const result = await checkIndex(url, apiKey);
      results.push({ url, isIndex: result.isIndex });
    } catch (error) {
      results.push({ url, isIndex: false, error: error.message });
    }
    await new Promise(resolve => setTimeout(resolve, 3000));
  }

  if (urls.length === 1) {
    const result = results[0];
    bot.sendMessage(chatId, result.isIndex ? 'Indexed' : result.error || 'Not Indexed');
  } else {
    await createAndSendCsv(chatId, results);
  }
});

// Xử lý file .txt
bot.on('document', async (msg) => {
  const chatId = msg.chat.id;
  console.log(`Received document from chat ${chatId}`);
  const fileId = msg.document.file_id;

  try {
    const file = await bot.getFile(fileId);
    const filePath = `https://api.telegram.org/file/bot${TELEGRAM_TOKEN}/${file.file_path}`;
    const response = await axios.get(filePath);
    const urls = response.data.split('\n').map(url => url.trim()).filter(url => url);

    if (urls.length === 0) {
      bot.sendMessage(chatId, 'File không chứa URL hợp lệ.');
      return;
    }

    bot.sendMessage(chatId, `Đang kiểm tra ${urls.length} URL từ file...`);

    const results = [];
    for (const url of urls) {
      try {
        const apiKey = await getNextApiKey();
        const result = await checkIndex(url, apiKey);
        results.push({ url, isIndex: result.isIndex });
      } catch (error) {
        results.push({ url, isIndex: false, error: error.message });
      }
      await new Promise(resolve => setTimeout(resolve, 3000));
    }

    if (urls.length === 1) {
      const result = results[0];
      bot.sendMessage(chatId, result.isIndex ? 'Indexed' : result.error || 'Not Indexed');
    } else {
      await createAndSendCsv(chatId, results);
    }
  } catch (error) {
    bot.sendMessage(chatId, `Lỗi khi xử lý file: ${error.message}`);
  }
});

// Khởi động server
const PORT = process.env.PORT || 10000;
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
