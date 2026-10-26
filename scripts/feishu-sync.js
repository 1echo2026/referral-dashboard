'use strict';

require('../env');
const { syncFeishu } = require('../feishu');

syncFeishu()
  .then((result) => {
    console.log(JSON.stringify(result, null, 2));
  })
  .catch((err) => {
    console.error('同步失败：' + err.message);
    process.exit(1);
  });
