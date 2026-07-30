const express = require('express');
const mysql = require('mysql2');
const path = require('path');
const axios = require('axios');
const cors = require('cors');
const { Rcon } = require('rcon-client');
require('dotenv').config();

const app = express();

app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname)));

// Токен CryptoBot (из .env или фолбэк)
const CRYPTO_BOT_TOKEN = process.env.CRYPTO_BOT_TOKEN || '612520:AAnEvolMcUAEbmY6fVHB5koXsRHJBLmC0eH';

// Подключение к БД
const db = mysql.createPool({
    host: process.env.DB_HOST,
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    database: process.env.DB_NAME,
    port: process.env.DB_PORT || 3306,
    waitForConnections: true,
    connectionLimit: 10,
    queueLimit: 0,
    ssl: { rejectUnauthorized: false }
});

const RCON_CONFIG = {
    host: process.env.RCON_HOST,
    port: Number(process.env.RCON_PORT),
    password: process.env.RCON_PASSWORD
};

// Функция сборки правильной Minecraft-команды
function buildMinecraftCommand(username, item, itemId, amount) {
    const name = item ? item.toUpperCase() : '';

    // Привилегии
    if (name.includes('VIP')) return `lp user ${username} parent add vip`;
    if (name.includes('PREMIUM')) return `lp user ${username} parent add premium`;
    if (name.includes('DELUXE')) return `lp user ${username} parent add deluxe`;
    if (name.includes('ENERGY')) return `lp user ${username} parent add energy`;
    if (name.includes('HYBRID')) return `lp user ${username} parent add hybrid`;

    // Кейсы
    if (itemId === 'donat_case' || name.includes('ДОНАТ')) return `crates givekey ${username} donat 1`;
    if (itemId === 'money_case' || name.includes('ВАЛЮТ')) return `crates givekey ${username} money 1`;
    if (itemId === 'coin_case' || name.includes('МОНЕТ')) return `crates givekey ${username} coins 1`;

    // Наказания
    if (itemId === 'unban' || name.includes('РАЗБАН')) return `unban ${username}`;
    if (itemId === 'unmute' || name.includes('РАЗМУТ')) return `unmute ${username}`;

    // Донат валюта (Курс 1 руб = 2 валюты)
    if (itemId && itemId.startsWith('currency_')) {
        const coins = itemId.split('_')[1];
        return `eco give ${username} ${coins}`;
    }

    return `eco give ${username} ${amount * 2}`;
}

// ==========================================
// 1. МАРШРУТ СОЗДАНИЯ ПОКУПКИ И ИНВОЙСА
// ==========================================
app.post('/create-invoice', async (req, res) => {
    try {
        const { username, email, item, itemId, amount } = req.body;

        if (!username || !item || !amount) {
            return res.status(400).json({ error: 'Не все обязательные поля заполнены' });
        }

        // Собираем команду для RCON
        const command = buildMinecraftCommand(username, item, itemId, amount);
        const amountRub = Number(amount).toFixed(2);

        // Запрос к CryptoBot
        const cryptoResponse = await axios.post('https://pay.crypt.bot/api/createInvoice', {
            currency_type: 'fiat',
            fiat: 'RUB',
            amount: amountRub,
            description: `Покупка ${item} для ${username}`,
            payload: JSON.stringify({ username, item, command }),
            paid_btn_name: 'callback',
            paid_btn_url: 'https://krios-3gzc.onrender.com/success'
        }, {
            headers: {
                'Crypto-Pay-API-Token': CRYPTO_BOT_TOKEN,
                'Content-Type': 'application/json'
            }
        });

        if (!cryptoResponse.data.ok) {
            console.error('[CryptoBot API Error]:', cryptoResponse.data);
            return res.status(400).json({ error: 'Не удалось создать платеж в CryptoBot' });
        }

        const paymentUrl = cryptoResponse.data.result.pay_url;

        // Запись покупки в база данных со статусом pending
        const insertQuery = 'INSERT INTO purchases (username, email, item, amount, command, status, date) VALUES (?, ?, ?, ?, ?, ?, NOW())';
        
        db.query(insertQuery, [username, email, item, amount, command, 'pending'], (err, result) => {
            if (err) {
                console.error('[MySQL Error]:', err);
                return res.status(500).json({ error: 'Не удалось создать запись о покупке в БД' });
            }

            res.json({ 
                success: true,
                url: paymentUrl 
            });
        });

    } catch (error) {
        console.error('Ошибка при обращении к CryptoBot API:', error.response?.data || error.message);
        res.status(500).json({ error: error.response?.data?.error || 'Ошибка связи с платежным шлюзом' });
    }
});

// ==========================================
// 2. ВЕБХУК ОТ CRYPTOBOT (АВТОМАТИЧЕСКАЯ ВЫДАЧА)
// ==========================================
app.post('/api/crypto-webhook', async (req, res) => {
    const update = req.body;

    if (update && update.update_type === 'invoice_paid') {
        const invoice = update.payload;
        
        try {
            const customData = JSON.parse(invoice.payload);
            const { username, item, command } = customData;

            console.log(`[CryptoBot] Оплата получена! Игрок: ${username}, товар: ${item}`);

            // Выдача доната по RCON
            const rcon = await Rcon.connect(RCON_CONFIG);
            
            if (command) {
                const rconResponse = await rcon.send(command);
                console.log(`[RCON] Консоль сервера ответила: ${rconResponse}`);
            }

            await rcon.end();

            // Обновление статуса в БД
            db.query("UPDATE purchases SET status = 'completed' WHERE username = ? AND status = ? ORDER BY id DESC LIMIT 1", [username, 'pending']);

        } catch (err) {
            console.error('[RCON Error] Ошибка при выдаче доната:', err);
        }
    }

    res.status(200).send('OK');
});

// Админская команда
app.get('/admin-give', async (req, res) => {
    const { secret, cmd } = req.query;

    if (secret !== process.env.ADMIN_SECRET) {
        return res.status(403).send("<h1>Доступ запрещен!</h1>");
    }

    try {
        const rcon = await Rcon.connect(RCON_CONFIG);
        const response = await rcon.send(cmd);
        await rcon.end();

        return res.send(`<h2>Успех!</h2><p>Ответ: ${response}</p>`);
    } catch (error) {
        console.error("[RCON Error]:", error);
        return res.status(500).send("<h1>Ошибка выполнения команды на сервере</h1>");
    }
});

// Главная страница
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'index.html'));
});

const PORT = process.env.PORT || 10000;
app.listen(PORT, '0.0.0.0', () => {
    console.log(`[Backend] Сервер работает на порту ${PORT}`);
});