const {Context} = require('@oanda/v20/context')
const path = require('path')

const Granularity = {
  HOURS: 'H',
  MINUTES: 'M',
  SECONDS: 'S',
  DAYS: 'D'
}

class OandaApi {
  constructor(locationConfig) {
    const config = require(locationConfig || path.resolve(__dirname, './config'))
    this.config = config
    this.token = config.oanda.token
    this.accountId = config.oanda.account
    this.practice = config.oanda.practice
    this.ssl = true
    this.port = 443
    this.restApi = {
      'practice': 'api-fxpractice.oanda.com',
      'live': 'api-fxtrade.oanda.com'
    }
    this.streamApi = {
      'practice': 'stream-fxpractice.oanda.com',
      'live': 'stream-fxtrade.oanda.com'
    }
    this.host = this.practice ? this.restApi.practice : this.restApi.live

    this.ctx = new Context(this.host, this.port, this.ssl, 'myjs')
    this.ctx.setToken(this.token)
  }

  async syncAccount() {
    const body = await this._getAccount()
    this.account = new this.ctx.account.Account(
      body.account)
    return this.account
  }

  async _fetchTradesOfState(symbol, state) {
    let trades = []
    let execute = true
    let beforeId = null
    while(execute) {
      let body = await this._fetchTrades(symbol, state, 500, beforeId)
      body.trades.forEach((trade) => {
        trades.push(new this.ctx.trade.Trade(trade))
      })
      if (body.trades.length == 0) {
        execute = false
        break
      }
      beforeId = body.trades[body.trades.length-1].id
    }
    return trades
  }

  async fetchTrades(symbol) {
    let trades = await this._fetchTradesOfState(symbol,'CLOSED')
    if(!this.trades) {
      this.trades = trades
    } else {
      this.trades = this.trades.concat(trades)
    }
    trades = await this._fetchTradesOfState(symbol,'OPEN')
    this.trades = this.trades.concat(trades)

    return this.trades
  }

  async fetchMarkets() {
    const body = await this._fetchMarkets()
    if (!this.instruments) {
      this.instruments = []
    }

    body.instruments.forEach((instrument) => {
      this._log(instrument)
      this.instruments.push(new this.ctx.primitives.Instrument(instrument))
    })
    return this.instruments
  }

  async getPrice(symbol, timeFrame, granularity, noBackCandles, format) {
    const body = await this._getPriceNow(symbol, timeFrame, granularity, noBackCandles, format)
    if (!this.price) {
      this.price = {}
    }

    console.log(body);
    let data = format.split('').map((_,idx) => {
      let result = []
      body[idx].candles.forEach((key) => {
        result.push(new this.ctx.instrument.Candlestick(key))
      })
      return  result
    })

    format.split('').forEach((key,idx)  => {
      this.price[key] = data[idx]
    })

    let currentPrice = {}

    format.split('').forEach((letter) => {
      return currentPrice[letter] =  this.price[letter][this.price[letter].length-1]
    })

    return {candles: this.price, currentPrice: currentPrice}

  }

  _fetchTrades(symbol, state, count, beforeId) {
    return new Promise((resolve, reject) => {
      let qparams = {
        instrument: symbol, state: state, count: count
      }
      if(beforeId != null) {
        qparams.beforeID = beforeId
      }
      this.ctx.trade.list(this.accountId, qparams, (res) => {
        if (res.statusCode === '200') {
          resolve(res.body)
        } else {
          reject(JSON.parse(res.rawBody))
        }
      })
    })
  }
  _fetchMarkets() {
    return new Promise((resolve, reject) => {
      this.ctx.account.instruments(this.accountId, {}, (res) => {
        if (res.statusCode === '200') {
          resolve(res.body)
        } else {
          reject(JSON.parse(res.rawBody))
        }
      })
    })
  }


  _getAccount() {
    return new Promise((resolve, reject) => {
      this.ctx.account.get(this.accountId, (res) => {
        if (res.statusCode === '200') {
          resolve(res.body)
        } else {
          reject(JSON.parse(res.rawBody))
        }
      })
    })
  }

  _getPricesFromTo(symbol, from, to, timeFrame, granularity,  format='M') {
    let promises = format.split('').map((priceFormat) => {
      return new Promise((resolve, reject) => {
        this.ctx.instrument.candles(symbol, {from: from, to: to, granularity: `${timeFrame}${granularity}`, price: priceFormat}, (res) => {
          if (res.statusCode === '200') {
            resolve(res.body)
          } else {
            reject(JSON.parse(res.rawBody))
          }
        })
      })
    })
    return Promise.all(promises)
  }

  _getPriceNow(symbol, timeFrame, granularity, noBackCandles=200,  format='M') {
    let promises = format.split('').map((priceFormat) => {
      return new Promise((resolve, reject) => {
        this.ctx.instrument.candles(symbol, {
          count: noBackCandles,
          granularity: `${timeFrame}${granularity}`,
          price: priceFormat
        }, (res) => {
          if (res.statusCode === '200') {
            resolve(res.body)
          } else {
            console.log(res)
            reject(JSON.parse(res.rawBody))
          }
        })
      })
    })

    return Promise.all(promises)
  }

  _log(data) {
    console.log(JSON.stringify(data, null, 4))
  }
  _getDate(year, month, day) {
    return Date.UTC(year, month, day) / 1000
  }
}

let oApi = new OandaApi()
oApi.getPrice('WTICO_USD', Granularity.MINUTES, 1, 1, 'MBA').then((data) => {
  oApi._log(data)
})
exports.OandaApi = OandaApi
exports.Granularity = Granularity
