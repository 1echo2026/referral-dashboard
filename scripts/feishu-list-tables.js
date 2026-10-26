'use strict';

require('../env');
const { listTables } = require('../feishu');

listTables()
  .then((tables) => {
    console.log('飞书多维表格中的数据表：');
    for (const table of tables) console.log(`${table.name}\t${table.tableId}`);
  })
  .catch((err) => {
    console.error('读取失败：' + err.message);
    process.exit(1);
  });
