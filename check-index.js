// check-index.js
require('dotenv').config();
const fs = require('fs');
const axios = require('axios');
const ExcelJS = require('exceljs');

const SERPER_API_KEY = process.env.SERPER_API_KEY;
const INPUT_FILE = 'input.txt';
const OUTPUT_FILE = 'output.xlsx';

async function checkIndex(url) {
  try {
    const query = `site:${url}`;
    const res = await axios.post(
      'https://google.serper.dev/search',
      { q: query },
      {
        headers: {
          'X-API-KEY': SERPER_API_KEY,
          'Content-Type': 'application/json',
        },
      }
    );

    const found = res.data.organic?.some(result => {
      return result.link?.includes(url.replace(/^https?:\/\//, '').replace(/\/$/, ''));
    });

    return found ? 'Indexed' : 'No';
  } catch (err) {
    console.error(`Error checking ${url}:`, err.message);
    return 'Error';
  }
}

async function run() {
  const urls = fs.readFileSync(INPUT_FILE, 'utf-8').split('\n').map(line => line.trim()).filter(Boolean);
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet('Results');

  sheet.columns = [
    { header: 'URL', key: 'url', width: 50 },
    { header: 'Index Status', key: 'status', width: 15 },
  ];

  for (const url of urls) {
    const status = await checkIndex(url);
    console.log(`${url} => ${status}`);
    sheet.addRow({ url, status });
  }

  await workbook.xlsx.writeFile(OUTPUT_FILE);
  console.log(`Done. Output saved to ${OUTPUT_FILE}`);
}

run();
