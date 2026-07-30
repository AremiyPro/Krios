const express = require('express');
const mysql = require('mysql2');
const path = require('path');
const axios = require('axios');
const cors = require('cors');
const { Rcon } = require('rcon-client');
require('dotenv').config({ path: './host.env' });

console.log('[ENV Check] Хост из файла:', process.env.DB_HOST);
console.log('[ENV Check] Порт из файла:', process.env.DB_PORT);

const app = express();

app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname)));

// База данных MySQL
const db = mysql.createConnection({
    host: process.env.DB_HOST,
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    database: process.env.DB_NAME,
    port: process.env.DB_PORT || 20766,
    ssl: {
        rejectUnauthorized: false
    }
});

db.connect((err) => {
    if (err) {
        console.error('[MySQL] Ошибка подключения к базе данных:', err);
        return;
    }
    console.log('[MySQL] Успешное подключение к базе данных сервера!');
});

// Конфигурация CryptoBot и RCON
const CRYPTO_BOT_TOKEN = process.env.CRYPTO_BOT_TOKEN || '612520:AAnEvolMcUAEbmY6fVHB5koXsRHJBLmC0eH';
const RCON_CONFIG = {
    host: '31.57.117.1', 
    port: 25682,        
    password: 'tCe3tFk9VE'
};

// Адрес Minecraft сервера для проверки онлайна
const MINECRAFT_SERVER_IP = 'kriosworld.mclan.ru:25672';

// ==========================================
// 1. МАРШРУТ ПОЛУЧЕНИЯ ОНЛАЙНА СЕРВЕРА
// ==========================================
app.get('/api/online', async (req, res) => {
    try {
        const response = await axios.get(`https://api.mcsrvstat.us/2/${MINECRAFT_SERVER_IP}`, {
            timeout: 5000
        });
        
        const data = response.data;
        if (data && data.online) {
            return res.json({
                online: true,
                players: data.players ? data.players.online : 0,
                max: data.players ? data.players.max : 0
            });
        }

        return res.json({ online: false, players: 0, max: 0 });
    } catch (error) {
        console.error('[Online API Error]:', error.message);
        return res.json({ online: false, players: 0, max: 0 });
    }
});

// ==========================================
// 2. МАРШРУТ СОЗДАНИЯ ПОКУПКИ И ИНВОЙСА
// ==========================================
app.post('/create-invoice', async (req, res) => {
    try {
        const { username, email, item, amount } = req.body;

        if (!username || !item || !amount) {
            return res.status(400).json({ error: 'Не все поля заполнены' });
        }

        // Команды для выдачи товара
        let command = '';
        if (item === 'VIP') command = `lp user ${username} parent add vip`;
        else if (item === 'PREMIUM') command = `lp user ${username} parent add premium`;
        else if (item === 'DELUXE') command = `lp user ${username} parent add deluxe`;
        else if (item === 'ENERGY') command = `lp user ${username} parent add energy`;
        else if (item === 'HYBRID') command = `lp user ${username} parent add hybrid`;
        else if (item.includes('Кейс')) command = `crates givekey ${username} ${item} 1`;
        else if (item.includes('Разбан')) command = `unban ${username}`;
        else if (item.includes('Размут')) command = `unmute ${username}`;
        else command = `eco give ${username} ${amount}`;

        const amountRub = Number(amount).toFixed(2);

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
            return res.status(400).json({ error: 'Не удалось создать платеж в CryptoBot' });
        }

        const paymentUrl = cryptoResponse.data.result.pay_url;

        // Сохранение записи в БД со статусом pending
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
        res.status(500).json({ error: 'Ошибка связи с платежным шлюзом' });
    }
});

// ==========================================
// 3. ВЕБХУК ОТ CRYPTOBOT (АВТОВЫДАЧА)
// ==========================================
app.post('/api/crypto-webhook', async (req, res) => {
    const update = req.body;

    if (update.update_type === 'invoice_paid') {
        const invoice = update.payload;
        
        try {
            const customData = JSON.parse(invoice.payload);
            const { username, item, command } = customData;

            console.log(`[CryptoBot] Оплата получена! Игрок: ${username}, товар: ${item}`);

            // Подключение RCON
            const rcon = await Rcon.connect(RCON_CONFIG);
            
            if (command) {
                const rconResponse = await rcon.send(command);
                console.log(`[RCON] Консоль сервера ответила: ${rconResponse}`);
            }

            await rcon.end();

            // Статус -> completed
            db.query("UPDATE purchases SET status = 'completed' WHERE username = ? AND status = ? ORDER BY id DESC LIMIT 1", [username, 'pending']);

        } catch (err) {
            console.error('[RCON Error] Ошибка при выдаче доната:', err);
        }
    }

    res.status(200).send('OK');
});

// ==========================================
// 4. АДМИН-ВЫДАЧА ТОВАРА (ТЕСТ)
// ==========================================
app.get('/admin-give', async (req, res) => {
    const { secret, cmd } = req.query;
    const MY_SECRET_PASSWORD = "super_admin_secret_123";

    if (secret !== MY_SECRET_PASSWORD) {
        return res.status(403).send("<h1>Доступ запрещен. Неверный пароль!</h1>");
    }

    if (!cmd) {
        return res.status(400).send("<h1>Ошибка: не указана команда (cmd).</h1>");
    }

    try {
        const rcon = await Rcon.connect(RCON_CONFIG);
        const response = await rcon.send(cmd);
        rcon.end();

        return res.send(`
            <h2>Успех! Команда отправлена на сервер.</h2>
            <p><b>Выполнено:</b> ${cmd}</p>
            <p><b>Ответ от сервера:</b> ${response}</p>
        `);
    } catch (error) {
        console.error("[RCON Admin Error]:", error);
        return res.status(500).send("<h1>Ошибка подключения по RCON. Проверьте консоль!</h1>");
    }
});

// Главная страница
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'Index.html'));
});

// Запуск единого сервера
const PORT = process.env.PORT || 10000;
app.listen(PORT, '0.0.0.0', () => {
    console.log(`[Backend] Сервер успешно запущен на порту ${PORT}`);
});