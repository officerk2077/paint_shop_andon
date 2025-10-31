const mysql = require('mysql2/promise');

const dbConfig = {
    host: 'localhost',
    user: 'root',
    password: '3011',
    database: 'paint_shop_andon',
    waitForConnections: true,
    connectionLimit: 10,
    queueLimit: 0
};

const pool = mysql.createPool(dbConfig);
console.log('✅ Pool kết nối database đã được tạo.');

module.exports = pool;