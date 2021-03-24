const {OandaApi, Granularity} = require('./oanda')
  , path = require('path')
  // eslint-disable-next-line no-unused-lets
  , colors = require('colors')
  , _ = require('lodash')

module.exports = function oanda (conf) {
  let public_client, authed_client

  function publicClient () {
    if (!public_client) public_client = new OandaApi();
    return public_client
  }

  function authedClient () {
    if (!authed_client) {
      if (!conf.oanda || !conf.oanda.token || conf.oanda.token === 'YOUR-API-KEY') {
        throw new Error('please configure your Oanda credentials in ' + path.resolve(__dirname, 'config.json'))
      }
      authed_client = new OandaApi()
    }
    return authed_client
  }

  /**
   * Convert WTICO-USD to WTICO_USD
   *
   * @param product_id WTICO-USD
   * @returns {string}
   */
  function joinProduct(product_id) {
    let split = product_id.split('-')
    return split[0] + '_' + split[1]
  }

  function retry (method, args, err) {
    if (method !== 'getTrades') {
      console.error(('\nOanda API is down! unable to call ' + method + ', retrying in 20s').red)
      if (err) console.error(err)
      console.error(args.slice(0, -1))
    }
    setTimeout(function () {
      exchange[method].apply(exchange, args)
    }, 20000)
  }

  let orders = {}

  let exchange = {
    name: 'oanda',
    historyScan: 'forward',
    historyScanUsesTime: true,
    makerFee: 0.1,
    takerFee: 0.1,

    getProducts: function () {
      return require('./products.json')
    },

    getTrades: function (opts, cb) {
      let func_args = [].slice.call(arguments)
      let client = authedClient()
      let startTime = null
      let args = {}
      if (opts.from) {
        startTime = opts.from
      } else {
        startTime = parseInt(opts.to, 10) - 3600000
        opts.from = startTime
        args['endTime'] = opts.to
      }

      const symbol = joinProduct(opts.product_id)
      client.fetchTrades(symbol).then((result) => {
        let trades = result.map((trade) => {
          let tradeTimestamp = Date.parse(trade.closeTime || trade.openTime)
          if((opts.from && opts.from <= tradeTimestamp) ||
            (opts.to && tradeTimestamp >= opts.to)){
            return {
              trade_id: trade.id,
              time: Date.parse(trade.closeTime || trade.openTime),
              size: Math.abs(parseFloat(trade.initialUnits)),
              price: parseFloat(trade.price),
              side: parseFloat(trade.initialUnits) < 0 ? 'sell' : 'buy'
            }
          }
        })
        cb(null, trades)
      }).catch(function (error) {
        console.error('An error occurred', error)
        return retry('getTrades', func_args)
      })
    },

    getBalance: function (opts, cb) {
      let func_args = [].slice.call(arguments)
      let client = authedClient()
      client.syncAccount().then((account) => {
        let balance = {asset: 0, currency: 0}
        if(account.currency === opts.currency) {
          balance.currency = account.NAV
          balance.currency_hold = account.NAV - account.balance
        }

        let values = account.trades.map((trade) => {
          if(trade.instrument.includes(opts.asset)) {
            return trade.currentUnits
          }
        })

        for(let i = 0, len = length(values); i < len; i++) {
          balance.asset += values[i]
        }

        balance.asset_hold = balance.asset
        cb(null, balance)
      }).catch(function (error) {
        console.error('An error occurred', error)
        return retry('getBalance', func_args)
      })
    },

    getQuote: function (opts, cb) {
      let func_args = [].slice.call(arguments)
      let client = authedClient()
      client.getPrice(joinProduct(opts.product_id), Granularity.MINUTES, 1, 1, 'MBA').then(result => {
        cb(null, { bid: result.currentPrice.B.bid.c, ask: result.currentPrice.A.ask.c })
      }).catch(function (error) {
        console.error('An error occurred', error)
        return retry('getQuote', func_args)
      })
    },

    /*WARNING oanda not working api for orderBook*/
    getDepth: function (opts, cb) {
      let func_args = [].slice.call(arguments)
      let client = authedClient()
      client._getOrderBook(joinProduct(opts.product_id), client._getDate(opts.year,  opts.month, opts.day,  opts.hour, opts.minute, opts.second)).then(result => {
        cb(null, result)
      }).catch(function(error) {
        console.error('An error ocurred', error)
        return retry('getDepth', func_args)
      })
    },

    cancelOrder: function (opts, cb) {
      let func_args = [].slice.call(arguments)
      let client = authedClient()
      client._cancelOrder(opts.order_id, joinProduct(opts.product_id)).then((body) => {
        cb(null, body)
      }).catch((err) => {
        cb._log(err);
        if(err.statusCode !== '404') {
          return retry('cancelOrder', func_args, err)
        }
        cb()
      })
    },

    /** I am here **/
    buy: function (opts, cb) {
      let func_args = [].slice.call(arguments)
      let client = authedClient()
      if (typeof opts.post_only === 'undefined') {
        opts.post_only = true
      }
      opts.type = opts.type || 'market'
      //for futures
      opts.side = opts.side || 'buy'
      let args = Object.create(opts)
      delete args.type
      delete args.side
      delete args.price
      let order = {}
      client.createOrder(joinProduct(opts.product_id), opts.type, opts.side, opts.price, args).then((result) => {

        order = {
          id: result.orderCreateTransaction.id,
          status: 'open',
          price: result.orderCreateTransaction.price,
          size: result.orderCreateTransaction.units,
          post_only: !!opts.post_only,
          filled_size: '0',
          created_at: Date.parse(result.orderCreateTransaction.time),
          ordertype: opts.order_type
        }

        orders['~' + result.id] = order
        cb(null, order)
      }).catch(function (error) {

        if (error.rejectReason && error.rejectReason === 'INSUFFICIENT_FUNDS') {
          order = {
            status: 'rejected',
            reject_reason: 'balance'
          }
          return cb(null, order)
        }
        console.error('An error occurred', error)

        //TODO: decide when to retry or not

        return retry('buy', func_args)
      })
    },

    sell: function (opts, cb) {
      let func_args = [].slice.call(arguments)
      let client = authedClient()
      if (typeof opts.post_only === 'undefined') {
        opts.post_only = true
      }
      opts.type = 'limit'
      let args = {}
      if (opts.order_type === 'taker') {
        delete opts.post_only
        opts.type = 'market'
      } else {
        args.timeInForce = 'GTC'
      }
      opts.side = 'sell'
      delete opts.order_type
      let order = {}
      client.createOrder(joinProduct(opts.product_id), opts.type, opts.side, this.roundToNearest(opts.size, opts), opts.price, args).then(result => {
        if (result && result.message === 'Insufficient funds') {
          order = {
            status: 'rejected',
            reject_reason: 'balance'
          }
          return cb(null, order)
        }
        order = {
          id: result ? result.id : null,
          status: 'open',
          price: opts.price,
          size: this.roundToNearest(opts.size, opts),
          post_only: !!opts.post_only,
          created_at: new Date().getTime(),
          filled_size: '0',
          ordertype: opts.order_type
        }
        orders['~' + result.id] = order
        cb(null, order)
      }).catch(function (error) {
        console.error('An error occurred', error)

        // decide if this error is allowed for a retry:
        // {"code":-1013,"msg":"Filter failure: MIN_NOTIONAL"}
        // {"code":-2010,"msg":"Account has insufficient balance for requested action"}

        if (error.message.match(new RegExp(/-1013|MIN_NOTIONAL|-2010/))) {
          return cb(null, {
            status: 'rejected',
            reject_reason: 'balance'
          })
        }

        return retry('sell', func_args)
      })
    },

    /**TODO: implement  futures**/

    roundToNearest: function(numToRound, opts) {
      let numToRoundTo = _.find(this.getProducts(), { 'asset': opts.product_id.split('-')[0], 'currency': opts.product_id.split('-')[1] }).min_size
      numToRoundTo = 1 / (numToRoundTo)

      return Math.floor(numToRound * numToRoundTo) / numToRoundTo
    },

    getOrder: function (opts, cb) {
      let func_args = [].slice.call(arguments)
      let client = authedClient()
      let order = orders['~' + opts.order_id]
      client.fetchOrder(opts.order_id, joinProduct(opts.product_id)).then(function (body) {
        if (body.status !== 'open' && body.status !== 'canceled') {
          order.status = 'done'
          order.done_at = new Date().getTime()
          order.filled_size = parseFloat(body.amount) - parseFloat(body.remaining)
          return cb(null, order)
        }
        cb(null, order)
      }, function(err) {
        return retry('getOrder', func_args, err)
      })
    },

    getCursor: function (trade) {
      return (trade.time || trade)
    }
  }
  return exchange
}
