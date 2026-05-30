const express = require('express');
const TelegramBot = require('node-telegram-bot-api');
const fs = require('fs');
const path = require('path');
const puppeteer = require('puppeteer');

const app = express();
const PORT = process.env.PORT || 3000;
app.use(express.json());

const TOKEN = process.env.TELEGRAM_TOKEN;
const bot = new TelegramBot(TOKEN, { polling: true });

const userStates = {};
app.use(express.static(path.join(__dirname)));

bot.onText(/\/start/, (msg) => {
  const chatId = msg.chat.id;
  bot.sendMessage(chatId, 'Добро пожаловать! Выберите действие:', {
    reply_markup: {
      keyboard: [['Сделать скриншот']],
      resize_keyboard: true
    }
  });
});

bot.on('message', async (msg) => {
  const chatId = msg.chat.id;
  const text = msg.text;
  const state = userStates[chatId];

  if (text === 'Сделать скриншот') {
    userStates[chatId] = { step: 'choosing_template' };
    return bot.sendMessage(chatId, 'Выберите тип скриншота:', {
      reply_markup: {
        keyboard: [['Вывод Bybit', 'Moneyback Binance']],
        resize_keyboard: true
      }
    });
  }

  if (!state) return;

  if (state.step === 'choosing_template') {
    if (text === 'Вывод Bybit') {
      state.template = 'template-bybit.html';
      state.step = 'waiting_for_bybit_data';
      return bot.sendMessage(chatId, `Отправь данные в формате:
Сумма в долларах
Сумма в NIO
Дата
Номер счёта
Комиссия`);
    }

    if (text === 'Moneyback Binance') {
      state.template = 'template-binance.html';
      state.step = 'waiting_for_binance_data';
      return bot.sendMessage(chatId, `Отправь данные в формате:
Сумма в NIO
Дата и время`);
    }

    return bot.sendMessage(chatId, 'Пожалуйста, выбери один из предложенных вариантов.');
  }

// BYBIT
if (state.step === 'waiting_for_bybit_data') {
  const lines = text.trim().split('\n');
  if (lines.length !== 5) {
    return bot.sendMessage(chatId, `Неверный формат. Отправь ровно 5 строк:
Сумма в долларах
Сумма в валюте
Дата
Номер счёта
Комиссия`);
  }

  const [usd, nio, date, account, commission] = lines.map(l => l.trim());
  state.data = { usd, nio, date, account, commission };

  // Спрашиваем валюту
  state.step = 'waiting_for_currency_bybit';
  return bot.sendMessage(chatId, 'Выберите валюту:', {
    reply_markup: {
      keyboard: [['PYG'], ['NIO'], ['USD']],
      resize_keyboard: true
    }
  });
}

if (state.step === 'waiting_for_currency_bybit') {
  state.data.currency = text;
  state.step = 'waiting_for_status';
  return bot.sendMessage(chatId, 'Выберите статус транзакции:', {
    reply_markup: {
      keyboard: [['Pay the network fee'], ['Processing'], ['Completed'], ['Error']],
      resize_keyboard: true
    }
  });
}

if (state.step === 'waiting_for_status') {
  state.data.status = text;
  return await generateAndSendScreenshot(chatId, state);
}

// BINANCE
if (state.step === 'waiting_for_binance_data') {
  const lines = text.trim().split('\n');
  if (lines.length !== 2) {
    return bot.sendMessage(chatId, `Неверный формат. Отправь данные в формате:
Сумма в NIO
Дата и время`);
  }

  const [nio, time] = lines.map(l => l.trim());
  state.data = { nio, time };

  // Спрашиваем валюту
  state.step = 'waiting_for_currency_binance';
  return bot.sendMessage(chatId, 'Выберите валюту:', {
    reply_markup: {
      keyboard: [['PYG'], ['NIO'], ['USD']],
      resize_keyboard: true
    }
  });
}

if (state.step === 'waiting_for_currency_binance') {
  state.data.currency = text;
  return await generateAndSendScreenshot(chatId, state);
}

});

// Генерация и отправка скриншота
async function generateAndSendScreenshot(chatId, state) {
  bot.sendMessage(chatId, 'Генерирую скриншот...');

  try {
    const templatePath = path.resolve(__dirname, state.template);
    let templateHtml = fs.readFileSync(templatePath, 'utf-8');

    const replacements = Object.entries(state.data).reduce((acc, [key, value]) => {
      acc[`{{${key}}}`] = value;
      return acc;
    }, {});

    for (const [key, value] of Object.entries(replacements)) {
      const regex = new RegExp(key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'g');
      templateHtml = templateHtml.replace(regex, value);
    }

    const browser = await puppeteer.launch({
      args: ['--no-sandbox', '--disable-setuid-sandbox'],
      headless: true
    });

    const page = await browser.newPage();
    await page.setContent(templateHtml, { waitUntil: 'networkidle0' });
    await page.setViewport({ width: 589, height: 1202 });

    const screenshot = await page.screenshot({
      type: 'png',
      clip: { x: 0, y: 0, width: 589, height: 1202 }
    });

    await browser.close();

    await bot.sendPhoto(chatId, screenshot);
    bot.sendMessage(chatId, 'Скриншот готов ✅', {
      reply_markup: {
        keyboard: [['Сделать скриншот']],
        resize_keyboard: true
      }
    });

    delete userStates[chatId];
  } catch (err) {
    console.error('Ошибка при создании скриншота:', err);
    bot.sendMessage(chatId, 'Произошла ошибка при создании скриншота ❌');
  }
}

// Express слушатель
app.get('/', (req, res) => {
  res.send('Сервер работает');
});

app.listen(PORT, () => {
  console.log(`Сервер запущен на http://localhost:${PORT}`);
});



