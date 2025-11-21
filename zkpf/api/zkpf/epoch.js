const { MOCK_EPOCH_RESPONSE } = require('./mock-data');
const { sendJson } = require('./helpers');

module.exports = async function handler(_req, res) {
  sendJson(res, 200, MOCK_EPOCH_RESPONSE);
};

