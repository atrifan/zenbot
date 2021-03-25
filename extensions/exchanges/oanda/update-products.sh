#!/usr/bin/env node
const {OandaApi} = require('./oanda')

new OandaApi().fetchMarkets().then((markets) => {
    var products = []

    var products = markets.map((market) => {
        return {
            id: market.name,
            asset: market.name.split("_")[0],
            currency: market.name.split("_")[1],
            min_size: market.minimumTradeSize,
            max_size: market.maximumOrderUnits,
            min_total: 0,
            increment: Number((10**market.pipLocation).toFixed(9)),
            asset_increment: Number((10**(-market.displayPrecision)).toFixed(9)),
            label: market.displayName
        };
    });

    var target = require('path').resolve(__dirname, 'products.json')
    require('fs').writeFileSync(target, JSON.stringify(products, null, 2))
    console.log('wrote', target)
    process.exit()
})
