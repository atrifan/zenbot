#!/usr/bin/env node
const {OandaApi} = require('./oanda')

new OandaApi().fetchMarkets().then((markets) => {
    var products = []

    var products = markets.map((market) => {
        console.log(market);
        return {
            name: market.name,
            type: market.type,
            displayName: market.displayName,
            pipLocation: market.pipLocation,
            displayPrecision: market.displayPrecision,
            tradeUnitsPrecision: market.tradeUnitsPrecision,
            minimumTradeSize: market.minimumTradeSize,
            maximumTrailingStopDistance: market.maximumTrailingStopDistance,
            minimumTrailingStopDistance: market.minimumTrailingStopDistance,
            maximumPositionSize: market.maximumPositionSize,
            maximumOrderUnits: market.maximumOrderUnits,
            marginRate: market.marginRate
        };
    });

    var target = require('path').resolve(__dirname, 'products.json')
    require('fs').writeFileSync(target, JSON.stringify(products, null, 2))
    console.log('wrote', target)
    process.exit()
})
