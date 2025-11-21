const { MOCK_POLICIES } = require('./mock-data');
const { sendJson } = require('./helpers');

module.exports = async function handler(_req, res) {
  sendJson(res, 200, { policies: MOCK_POLICIES });
};

