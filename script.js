// Catalog configuration
const catalog = {
    privileges: {
        title: "Список привилегий",
        items: [
            { name: "HYBRID", price: 569, image: "Foto/HYBRID.png" },
            { name: "ENERGY", price: 279, image: "Foto/ENERGY.png" },
            { name: "DELUXE", price: 139, image: "Foto/DELUXE.png" },
            { name: "PREMIUM", price: 69, image: "Foto/PREMIUM.png" },
            { name: "VIP", price: 29, image: "Foto/VIP.png" }
        ]
    },
    cases: {
        title: "Донат-кейсы",
        items: [
            { name: "Кейс с донатом", itemId: "donat_case", price: 89, image: "Foto/CASE.png" },
            { name: "Кейс с валютой", itemId: "money_case", price: 59, image: "Foto/CASE.png" },
            { name: "Кейс с монетами", itemId: "coin_case", price: 39, image: "Foto/CASE.png" }
        ]
    },
    other: {
        title: "Прочее",
        items: [
            { name: "Разбан ключ", itemId: "unban", price: 249, image: "Foto/UN.png" },
            { name: "Размут ключ", itemId: "unmute", price: 99, image: "Foto/UN.png" }
        ]
    }
};

const cartIconSvg = `
    <svg viewBox="0 0 24 24">
        <path d="M7 18c-1.1 0-1.99.9-1.99 2S5.9 22 7 22s2-.9 2-2-.9-2-2-2zM1 2v2h2l3.6 7.59-1.35 2.45c-.16.28-.25.61-.25.96 0 1.1.9 2 2 2h12v-2H7.42c-.14 0-.25-.11-.25-.25l.03-.12.9-1.63h7.45c.75 0 1.41-.41 1.75-1.03l3.58-6.49c.08-.14.12-.31.12-.48 0-.55-.45-1-1-1H5.21l-.94-2H1zm16 16c-1.1 0-1.99.9-1.99 2s.89 2 1.99 2 2-.9 2-2-.9-2-2-2z"/>
    </svg>
`;

let currentAmount = 0;
let currentItemId = null;

function renderCategory(categoryKey) {
    const categoryData = catalog[categoryKey];
    if (!categoryData) return;

    const titleElement = document.getElementById('categoryTitle');
    if (titleElement) titleElement.innerText = categoryData.title;
    
    const container = document.getElementById('productsRow');
    if (!container) return;

    container.innerHTML = categoryData.items.map(item => `
        <div class="product-card">
            <img class="product-card-bg" src="${item.image}" alt="${item.name}">
            <div class="product-overlay"></div>
            <div class="price-badge">${item.price} ₽</div>
            <div class="product-footer">
                <div class="product-name">${item.name}</div>
                <button class="btn-cart" onclick="openModal('${item.name}', ${item.price}, '${item.itemId || ''}')" title="Купить">
                    ${cartIconSvg}
                </button>
            </div>
        </div>
    `).join('');
}

function setCategory(categoryKey, btn) {
    document.querySelectorAll('.mode-btn').forEach(b => b.classList.remove('active'));
    if (btn) btn.classList.add('active');
    renderCategory(categoryKey);
}

function openModal(name, price, itemId = '') {
    const selectedItemInput = document.getElementById('selectedItemName');
    const modal = document.getElementById('buyModal');
    
    if (selectedItemInput) selectedItemInput.value = name;
    currentAmount = price;
    currentItemId = itemId;
    
    if (modal) modal.classList.add('active');
}

function closeModal() {
    const modal = document.getElementById('buyModal');
    if (modal) modal.classList.remove('active');
}

function closeModalOnBackdrop(event) {
    const modal = document.getElementById('buyModal');
    if (event.target === modal) closeModal();
}

const checkoutForm = document.getElementById('checkoutForm');
if (checkoutForm) {
    checkoutForm.addEventListener('submit', async (e) => {
        e.preventDefault();
        
        const username = document.getElementById('donorName')?.value.trim();
        const email = document.getElementById('donorEmail')?.value.trim();
        const itemName = document.getElementById('selectedItemName')?.value;

        const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
        if (!email || !emailRegex.test(email)) {
            alert("Пожалуйста, введите корректный адрес электронной почты!");
            return;
        }

        const btn = document.getElementById('submitBtn');
        if (btn) {
            btn.disabled = true;
            btn.innerText = 'Создание счета...';
        }

        try {
            const res = await fetch('/create-invoice', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ 
                    username: username, 
                    email: email, 
                    item: itemName,
                    itemId: currentItemId,
                    amount: currentAmount 
                })
            });

            const data = await res.json();
            
            if (!res.ok) {
                alert(data.error || 'Ошибка при обработке запроса.');
                if (btn) {
                    btn.disabled = false;
                    btn.innerText = 'Оплатить товар';
                }
                return;
            }

            if (data.url) {
                window.location.href = data.url;
            } else {
                alert('Ошибка при создании платежа: ссылка не получена.');
                if (btn) {
                    btn.disabled = false;
                    btn.innerText = 'Оплатить товар';
                }
            }
        } catch (e) {
            console.error("Ошибка сети:", e);
            alert('Сетевая ошибка при соединении с сервером.');
            if (btn) {
                btn.disabled = false;
                btn.innerText = 'Оплатить товар';
            }
        }
    });
}

const DISPLAY_IP = 'kriosworld.mclan.ru:25672'; 

document.addEventListener('DOMContentLoaded', () => {
    renderCategory('privileges');

    // Настройка плашки IP без проверки онлайна
    const badgeElement = document.querySelector('.ip-online-badge');
    if (badgeElement) {
        badgeElement.innerText = DISPLAY_IP;
        badgeElement.addEventListener('click', () => {
            navigator.clipboard.writeText(DISPLAY_IP);
            alert(`IP-адрес ${DISPLAY_IP} скопирован в буфер обмена!`);
        });
    }
});