'use strict';
const mysql = require('mysql2/promise');

function createPool(db) {
  return mysql.createPool({
    host: db.host,
    port: db.port,
    user: db.user,
    password: db.password,
    database: db.database,
    waitForConnections: true,
    connectionLimit: 5,
    decimalNumbers: true,
  });
}

module.exports = { createPool };
