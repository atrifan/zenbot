const {OandaApi, Granularity} = require('./oanda')
  , path = require('path')
  // eslint-disable-next-line no-unused-lets
  , colors = require('colors')
  , {v4} = require('uuid')
  , _ = require('lodash')

module.exports = function oanda (conf) {
  let authed_client
  let last_requested_time


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

    /**have to implement**/
    getTrades: function(opts, cb) {
      let func_args = [].slice.call(arguments)
      let client = authedClient()
      let startTime = null
      let args = {}
      if (opts.from) {
        startTime = opts.from
        let receivedDate = new Date(opts.from)
        //convert to UTC
        opts.from = (new Date(receivedDate.getTime() + receivedDate.getTimezoneOffset() * 60000)).getTime()
      } else {
        startTime = parseInt(opts.to, 10) - 3600000
        opts.from = startTime
        args['endTime'] = opts.to
      }

      if (last_requested_time != opts.from) {
        last_requested_time = opts.from
      } else {
        return cb(null, [])
      }
      opts.from = opts.from ? opts.from / 1000 : null
      opts.to = opts.to ? opts.to / 1000 : null
      const symbol = joinProduct(opts.product_id)
      client.getPricesFromTo(symbol, opts.from, opts.to, 'M', 1, 'BA').then((result) => {
        let trades_buy = result.B.map((trade) => {
          return {
            trade_id: v4(),
            time: Date.parse(trade.time),
            size: parseFloat(trade.volume),
            price: parseFloat(trade.bid.c),
            side: 'buy'
          }
        })
        let trades_sell = result.A.map((trade) => {
          return {
            trade_id: v4(),
            time: Date.parse(trade.time),
            size: parseFloat(trade.volume),
            price: parseFloat(trade.ask.c),
            side: 'sell'
          }
        })
        let trades = []
        for(let i = 0, len = trades_buy.length; i < len; i++) {
          trades.push(trades_buy[i])
          trades.push(trades_sell[i])
        }
        cb(null, trades)
      }).catch((err) => {
        console.error('An error occurred', err)
        return retry('getTrades', func_args)
      })
    },

    getClientTrades: function (opts, cb) {
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
          balance.currency = account.marginAvailable
          balance.currency_hold = 0
        }

        //TODO: might need to look at orders also
        let values = account.trades.map((trade) => {
          if(trade.instrument.includes(opts.asset)) {
            return trade.currentUnits
          }
        })

        for(let i = 0, len = values.length; i < len; i++) {
          //TODO: extracted the leverage from the asset_hold
          balance.asset += values[i] * account.marginRate
        }

        balance.asset_hold = 0
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
        cb._log(err)
        if(err.statusCode !== '404') {
          return retry('cancelOrder', func_args, err)
        }
        cb()
      })
    },

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
      delete args.size
      delete args.price
      client.buy(joinProduct(opts.product_id), opts.type, opts.size, opts.price, args).then((result) => {

        if(result.orderCancelTransaction && (result.orderCancelTransaction.reason === 'INSUFFICIENT_MARGIN' ||
          result.orderCancelTransaction.reason === 'INSUFFICIENT_LIQUIDITY')) {
          return cb(null, {
            status: 'rejected',
            reject_reason: 'balance'
          })
        }
        if(result.orderCancelTransaction && result.orderCancelTransaction.reason === 'MARKET_HALTED') {
          return retry('buy', func_args)
        }
        let order = {
          symbol: opts.product_id,
          id: result.orderCreateTransaction.clientExtensions.id,
          status: result.orderFillTransaction && result.orderFillTransaction.tradeOpened ? 'done' : 'open',
          done_at: result.orderFillTransaction && result.orderFillTransaction.tradeOpened ? Date.parse(result.orderFillTransaction.time) : null,
          price: result.orderCreateTransaction.price,
          size: result.orderCreateTransaction.units,
          post_only: !!opts.post_only,
          filled_size: '0',
          created_at: Date.parse(result.orderCreateTransaction.time),
          ordertype: opts.order_type,
          tradeID: result.orderFillTransaction && result.orderFillTransaction.tradeOpened ? result.orderFillTransaction.tradeOpened.tradeID : null
        }

        orders['~' + order.id] = order
        cb(null, order)
      }).catch(function (error) {

        if (error.rejectReason && error.rejectReason === 'INSUFFICIENT_FUNDS') {
          let order = {
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
      opts.type = opts.type || 'market'
      //for futures
      opts.side = 'sell'
      opts.size = -(opts.size)
      let args = Object.create(opts)
      delete args.type
      delete args.side
      delete args.size
      delete args.price
      client.buy(joinProduct(opts.product_id), opts.type, opts.size, opts.price, args).then((result) => {

        if(result.orderCancelTransaction && (result.orderCancelTransaction.reason === 'INSUFFICIENT_MARGIN' ||
          result.orderCancelTransaction.reason === 'INSUFFICIENT_LIQUIDITY')) {
          return cb(null, {
            status: 'rejected',
            reject_reason: 'balance'
          })
        }
        if(result.orderCancelTransaction && result.orderCancelTransaction.reason === 'MARKET_HALTED') {
          return retry('sell', func_args)
        }
        let order = {
          symbol: opts.product_id,
          id: result.orderCreateTransaction.clientExtensions.id,
          status: result.orderFillTransaction && result.orderFillTransaction.tradeOpened ? 'done' : 'open',
          done_at: result.orderFillTransaction && result.orderFillTransaction.tradeOpened ? Date.parse(result.orderFillTransaction.time) : null,
          price: result.orderCreateTransaction.price,
          size: result.orderCreateTransaction.units,
          post_only: !!opts.post_only,
          filled_size: '0',
          created_at: Date.parse(result.orderCreateTransaction.time),
          ordertype: opts.order_type,
          tradeID: result.orderFillTransaction && result.orderFillTransaction.tradeOpened ? result.orderFillTransaction.tradeOpened.tradeID : null
        }

        orders['~' + order.id] = order
        cb(null, order)
      }).catch(function (error) {

        if (error.rejectReason && error.rejectReason === 'INSUFFICIENT_FUNDS') {
          let order = {
            status: 'rejected',
            reject_reason: 'balance'
          }
          return cb(null, order)
        }
        console.error('An error occurred', error)

        //TODO: decide when to retry or not

        return retry('sell', func_args)
      })
    },

    close: function(opts, cb) {
      let func_args = [].slice.call(arguments)
      let client = authedClient()

      let order = orders['~' + opts.order_id]
      if(!order.tradeID) {
        return retry('close', func_args)
      }

      client.closeTrade(order.tradeID, opts.units).then((result) => {
        order.status = result.orderFillTransaction ? 'close': 'pending_close'
        order.close_start = result.orderCreateTransaction? Date.parse(result.orderCreateTransaction.time) : null
        order.close_at = result.orderFillTransaction? Date.parse(result.orderFillTransaction.time): null
        cb(null, order)
      }).catch((err) => {
        client._log(err)
        return retry('close', func_args)
      })
    },

    getOrder: function (opts, cb) {
      let func_args = [].slice.call(arguments)
      let client = authedClient()
      let order = orders['~' + opts.order_id]
      client.fetchOrder(opts.order_id, joinProduct(opts.product_id)).then(function (body) {
        if (body.order.state !== 'PENDING' && body.order.status !== 'CANCELLED' && body.order.status !== 'TRIGGERED') {
          order.status = 'done'
          order.done_at = Date.parse(body.order.filledTime)
          order.tradeID = body.order.tradeOpenedID
          order.filled_size = parseFloat(body.order.units)
          return cb(null, order)
        } else if(body.order.status === 'CANCELLED') {
          order.status = 'canceled'
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
