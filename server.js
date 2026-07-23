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
    host: '31.57.117.1', // IP твоего туннеля (например, playit.gg или ngrok)
    port: 32723,       // Порт RCON из server.properties
    password: 'j0vjLaYrEMUQ'
};

// ==========================================
// 1. МАРШРУТ ПРОВЕРКИ ИГРОКА (Временно отключен)
// ==========================================
app.post('/check-player', async (req, res) => {
    res.json({ success: true, message: "Проверка временно отключена" });
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

// Секретный маршрут для владельца (выдача через RCON без денег)
app.get('/admin-give', async (req, res) => {
    // Берем пароль и команду прямо из ссылки
    const { secret, cmd } = req.query;

    // СЕКРЕТНЫЙ ПАРОЛЬ (придумай свой и впиши сюда, чтобы никто другой не мог использовать)
    const MY_SECRET_PASSWORD = "super_admin_secret_123";

    if (secret !== MY_SECRET_PASSWORD) {
        return res.status(403).send("<h1>Доступ запрещен. Неверный пароль!</h1>");
    }

    if (!cmd) {
        return res.status(400).send("<h1>Ошибка: не указана команда (cmd).</h1>");
    }

    try {
        // Подключаемся к серверу по RCON
        const rcon = await Rcon.connect({
            host: '31.57.117.1', // IP твоего туннеля (например, playit.gg или ngrok)
            port: 32723,       // Порт RCON из server.properties
            password: 'j0vjLaYrEMUQ'
        });

        // Отправляем команду
        const response = await rcon.send(cmd);
        rcon.end(); // Закрываем соединение

        // Выводим результат прямо в браузер
        return res.send(`
            <h2>Успех! Команда отправлена на сервер.</h2>
            <p><b>Выполнено:</b> ${cmd}</p>
            <p><b>Ответ от сервера:</b> ${response}</p>
        `);

    } catch (error) {
        console.error("[RCON Admin Error]:", error);
        return res.status(500).send("<h1>Ошибка подключения к RCON. Смотри логи консоли Render.</h1>");
    }
});
