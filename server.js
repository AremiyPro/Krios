const express = require('express');
const mysql = require('mysql2');
const path = require('path');
const axios = require('axios');
const { Rcon } = require('rcon-client');
require('dotenv').config({ path: './host.env' });

// Проверим прямо при старте, видит ли скрипт файл
console.log('[ENV Check] Хост из файла:', process.env.DB_HOST);
console.log('[ENV Check] Порт из файла:', process.env.DB_PORT);

const app = express();

app.use(express.json());
app.use(express.static(path.join(__dirname)));

// Конфигурация базы данных MySQL
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
const CRYPTO_BOT_TOKEN = '612520:AAnEvolMcUAEbmY6fVHB5koXsRHJBLmC0eH';
const RCON_CONFIG = {
    host: '195.201.204.247', // IP твоего туннеля (например, playit.gg или ngrok)
    port: 25575,       // Порт RCON из server.properties
    password: 'j0vjLaYrEMUQ'
};

// Предварительно: npm install rcon-client
const { Rcon } = require('rcon-client');

app.post('/check-player', async (req, res) => {
    const { username } = req.body;

    if (!username) {
        return res.status(400).json({ success: false, message: "Укажите ник" });
    }

    try {
        // Подключаемся к игровому серверу
        const rcon = await Rcon.connect({
            host: "195.201.204.247",
            port: 25575, // Порт RCON
            password: "j0vjLaYrEMUQ"
        });

        // Отправляем команду списка игроков (пример для Minecraft)
        const response = await rcon.send("list");
        rcon.end();

        // Ответ обычно выглядит как: "There are 1 of a max of 20 players online: AremiyPro"
        // Проверяем, есть ли ник в ответе
        if (response.includes(username)) {
            return res.json({ success: true, message: "Игрок онлайн", online: true });
        } else {
            return res.json({ success: false, message: "Игрок оффлайн", online: false });
        }
    } catch (error) {
        console.error("Ошибка RCON:", error);
        return res.status(500).json({ success: false, message: "Не удалось связаться с игровым сервером" });
    }
});

// ==========================================
// 2. МАРШРУТ СОЗДАНИЯ ПОКУПКИ И ИНВОЙСА
// ==========================================
app.post('/create-invoice', async (req, res) => {
    try {
        const { username, email, item, amount } = req.body;

        // Определяем консольную команду для выдачи
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

        // Передаем сумму как есть, без конвертации в USD
        const amountRub = Number(amount).toFixed(2);

        const cryptoResponse = await axios.post('https://pay.crypt.bot/api/createInvoice', {
            currency_type: 'fiat', // Указываем API, что прайс в фиате
            fiat: 'RUB',           // Выбираем рубли
            amount: amountRub,     // Передаем рубли (например, '500.00')
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

        // Записываем покупку в базу данных со статусом pending
        const insertQuery = 'INSERT INTO purchases (username, email, item, amount, command, status, date) VALUES (?, ?, ?, ?, ?, ?, NOW())';
        
        db.query(insertQuery, [username, email, item, amount, command, 'pending'], (err, result) => {
            if (err) {
                console.error('[MySQL Error]:', err);
                return res.status(500).json({ error: 'Не удалось создать запись о покупке в БД' });
            }

            // Возвращаем игроку ссылку на оплату в CryptoBot
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
// 3. ВЕБХУК ОТ CRYPTOBOT (АВТОМАТИЧЕСКАЯ ВЫДАЧА)
// ==========================================
app.post('/api/crypto-webhook', async (req, res) => {
    const update = req.body;

    if (update.update_type === 'invoice_paid') {
        const invoice = update.payload;
        
        try {
            const customData = JSON.parse(invoice.payload);
            const { username, item, command } = customData;

            console.log(`[CryptoBot] Оплата получена! Игрок: ${username}, товар: ${item}`);

            // Подключаемся к серверу через RCON для выдачи доната
            const rcon = await Rcon.connect(RCON_CONFIG);
            
            if (command) {
                const rconResponse = await rcon.send(command);
                console.log(`[RCON] Консоль сервера ответила: ${rconResponse}`);
            }

            await rcon.end();

            // Обновляем статус в базе данных на completed
            db.query("UPDATE purchases SET status = 'completed' WHERE username = ? AND status = ? ORDER BY id DESC LIMIT 1", [username, 'pending']);

        } catch (err) {
            console.error('[RCON Error] Ошибка при выдаче доната на сервер:', err);
        }
    }

    res.status(200).send('OK');
});

// Обработка главной страницы
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'Index.html'));
});

// Запуск единого сервера
const PORT = process.env.PORT || 10000;
app.listen(PORT, '0.0.0.0', () => {
    console.log(`[Backend] Сервер успешно запущен на порту ${PORT}`);
});