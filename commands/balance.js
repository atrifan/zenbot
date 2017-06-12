var minimist = require('minimist')
  , n = require('numbro')
  , colors = require('colors')
  , moment = require('moment')

module.exports = function container (get, set, clear) {
  var c = get('conf')
  return function (program) {
    program
      .command('balance [selector]')
      .allowUnknownOption()
      .description('get asset and currency balance from the exchange')
      //.option('--all', 'output all balances')
      .option('-c, --calculate_currency <calculate_currency>', 'show the full balance in another currency')
      .option('--debug', 'output detailed debug info')
      .action(function (selector, cmd) {
        var s = {options: minimist(process.argv)}
        s.selector = get('lib.normalize-selector')(selector || c.selector)
        var exch = s.selector.split('.')[0]
        s.exchange = get('exchanges.' + exch)
        s.product_id = s.selector.split('.')[1]
        s.asset = s.product_id.split('-')[0]
        s.currency = s.product_id.split('-')[1]
        var so = s.options
        delete so._
        Object.keys(c).forEach(function (k) {
          if (typeof cmd[k] !== 'undefined') {
            so[k] = cmd[k]
          }
        })
        so.debug = cmd.debug
        function balance () {
          s.exchange.getBalance(s, function (err, balance) {
            if (err) return cb(err)
            s.exchange.getQuote(s, function (err, quote) {
              if (err) throw err
              var bal = moment().format('YYYY-MM-DD HH:mm:ss').bgBlue
              bal += ' ' + (s.product_id + ' Asset: ').grey + balance.asset.white + ' Currency: '.grey + balance.currency.yellow + ' Total: '.grey + n(balance.asset).multiply(quote.ask).add(balance.currency).value().toString().yellow
              console.log(bal)

              if (so.calculate_currency) {
                s.exchange.getQuote({'product_id': s.asset + '-' + so.calculate_currency}, function (err, asset_quote) {
                  if (err)  throw err

                  s.exchange.getQuote({'product_id': s.currency + '-' + so.calculate_currency}, function (err, currency_quote) {
                    if (err)  throw err
                    var asset_total = balance.asset * asset_quote.bid
                    var currency_total = balance.currency * currency_quote.bid
                    console.log((so.calculate_currency + ': ').grey + (asset_total + currency_total))
                    process.exit()
                  })
                })
              }
              else {
                process.exit()
              }
            })
          })
        }

        balance()
      })
  }
}