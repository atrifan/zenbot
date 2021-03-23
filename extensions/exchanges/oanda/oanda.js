const {Context} = require("@oanda/v20/context");
const path = require('path')

const Granularity = {
  HOURS: 'H',
  MINUTES: 'M',
  SECONDS: 'S',
  DAYS: 'D'
};

class OandaApi {
  constructor(locationConfig) {
    const config = require(locationConfig || path.resolve(__dirname, './config'));
    this.config = config;
    this.token = config.oanda.token;
    this.accountId = config.oanda.account;
    this.practice = config.oanda.practice;
    this.ssl = true;
    this.port = 443;
    this.restApi = {
      'practice': 'api-fxpractice.oanda.com',
      'live': 'api-fxtrade.oanda.com'
    };
    this.streamApi = {
      'practice': 'stream-fxpractice.oanda.com',
      'live': 'stream-fxtrade.oanda.com'
    };
    this.host = this.practice ? this.restApi.practice : this.restApi.live;

    this.ctx = new Context(this.host, this.port, this.ssl, 'myjs');
    this.ctx.setToken(this.token);
  }

  async syncAccount() {
    const body = await this._getAccount();
    this.account = new this.ctx.Account(body.account);
    return this.account;
  }

  async getPrice(symbol, timeFrame, granularity) {
    const body = await this._getPriceNow(symbol, timeFrame, granularity);
    if (!this.data) {
      this.data = []
    }

    body.candles.forEach((key, idx) => {
      this.data.push(new this.ctx.instrument.Candlestick(key))
    });
    return {candles: this.data, currentPrice: this.data[this.data.length - 1]}

  }

  _getAccount() {
    return new Promise((resolve, reject) => {
      this.ctx.account.get(this.accountId, (res) => {
        if (res.statusCode == 200) {
          resolve(res.body);
        } else {
          reject(res.body);
        }
      })
    });
  }

  _getPricesFromTo(symbol, from, to, timeFrame, granularity) {
    return new Promise((resolve, reject) => {
      this.ctx.instrument.candles(symbol, {from: from, to: to, granularity: `${timeFrame}${granularity}`}, (res) => {
        if (res.statusCode == 200) {
          resolve(res.body);
        } else {
          reject(res.body);
        }
      })
    })
  }

  _getPriceNow(symbol, timeFrame, granularity) {
    return new Promise((resolve, reject) => {
      this.ctx.instrument.candles(symbol, {count: 200, granularity: `${timeFrame}${granularity}`}, (res) => {
        if (res.statusCode == 200 ) {
          resolve(res.body);
        } else {
          reject(res.body);
        }
      })
    })
  }

  _log(data) {
    console.log(JSON.stringify(data, null, 4));
  }
  _getDate(year, month, day) {
    return Date.UTC(year, month, day) / 1000;
  }
}

let oApi = new OandaApi();
oApi.getPrice('WTICO_USD', Granularity.HOURS, 1).then((data) => {
  console.log(data.currentPrice.mid.c);
});
