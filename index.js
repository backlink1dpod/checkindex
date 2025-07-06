const TelegramBot = require('node-telegram-bot-api');
   const axios = require('axios');
   const fs = require('fs');

   // Cấu hình bot Telegram
   const TELEGRAM_TOKEN = process.env.TELEGRAM_TOKEN; // Sử dụng biến môi trường
   const bot = new TelegramBot(TELEGRAM_TOKEN, { polling: true });

   // Danh sách API keys của SerpAPI
   const apiKeys = [
     process.env.SERPAPI_KEY_1,
     process.env.SERPAPI_KEY_2,
     process.env.SERPAPI_KEY_3 // Thêm các API key khác
   ];
   let currentApiKeyIndex = 0;

   // Hàm kiểm tra quota của API key
   async function checkApiQuota(apiKey) {
     try {
       const response = await axios.get(`https://serpapi.com/account.json?api_key=${apiKey}`);
       return response.data.searches_left || 0;
     } catch (error) {
       console.error(`Error checking quota for API key ${apiKey}: ${error.message}`);
       return 0;
     }
   }

   // Hàm chọn API key tiếp theo có quota
   async function getNextApiKey() {
     for (let i = 0; i < apiKeys.length; i++) {
       const quota = await checkApiQuota(apiKeys[currentApiKeyIndex]);
       if (quota > 0) {
         return apiKeys[currentApiKeyIndex];
       }
       currentApiKeyIndex = (currentApiKeyIndex + 1) % apiKeys.length;
     }
     throw new Error('All API keys have exhausted their quotas');
   }

   // Hàm kiểm tra index của một URL
   async function checkIndex(url, apiKey) {
     try {
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
       return { url, isIndex, status: response.status };
     } catch (error) {
       console.error(`Error checking index for ${url}: ${error.message}`);
       return { url, isIndex: false, status: 'Error' };
     }
   }

   // Xử lý tin nhắn từ người dùng
   bot.onText(/\/start/, (msg) => {
     const chatId = msg.chat.id;
     bot.sendMessage(chatId, 'Gửi danh sách URL (mỗi URL trên một dòng) hoặc tải lên file .txt chứa danh sách URL để kiểm tra index.');
   });

   // Xử lý tin nhắn chứa URL
   bot.on('text', async (msg) => {
     const chatId = msg.chat.id;
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
         results.push(`${url}: ${result.isIndex ? 'Indexed' : 'Not Indexed'}`);
       } catch (error) {
         results.push(`${url}: Error - ${error.message}`);
       }
       await new Promise(resolve => setTimeout(resolve, 1000));
     }

     bot.sendMessage(chatId, results.join('\n'));
   });

   // Xử lý file .txt
   bot.on('document', async (msg) => {
     const chatId = msg.chat.id;
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
           results.push(`${url}: ${result.isIndex ? 'Indexed' : 'Not Indexed'}`);
         } catch (error) {
           results.push(`${url}: Error - ${error.message}`);
         }
         await new Promise(resolve => setTimeout(resolve, 1000));
       }

       bot.sendMessage(chatId, results.join('\n'));
     } catch (error) {
       bot.sendMessage(chatId, `Lỗi khi xử lý file: ${error.message}`);
     }
   });

   // Xử lý lỗi polling
   bot.on('polling_error', (error) => {
     console.error(`Polling error: ${error.message}`);
   });
