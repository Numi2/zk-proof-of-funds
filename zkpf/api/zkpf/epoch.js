const { MOCK_EPOCH_RESPONSE } = require('./mock-data');
const { sendJson, handleCors } = require('./helpers');

module.exports = async function handler(req, res) {
  if (handleCors(req, res)) {
    return;
  }
  sendJson(res, 200, MOCK_EPOCH_RESPONSE);
};

