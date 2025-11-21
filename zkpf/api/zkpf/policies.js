const { MOCK_POLICIES } = require('./mock-data');
const { sendJson, handleCors } = require('./helpers');

module.exports = async function handler(req, res) {
  if (handleCors(req, res)) {
    return;
  }
  sendJson(res, 200, { policies: MOCK_POLICIES });
};

