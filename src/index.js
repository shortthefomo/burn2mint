const debug = require('debug')
const log = debug('test:client')
const dotenv = require('dotenv')
const { XrplClient } = require('xrpl-client')
const { derive, sign } = require('xrpl-accountlib')

async function clientApp() {
    const testnet = new XrplClient('wss://s.altnet.rippletest.net:51233')
    const hooks = new XrplClient('wss://hooks-testnet-v3.xrpl-labs.com')

    const account_info = {
        command: 'account_info', 
        account: process.env.WALLET_ADDRESS,
        ledger_index: 'current'
    }
    const testnet_info = await testnet.send(account_info)
    log('testnet_info', testnet_info)

    const hooks_info = await hooks.send(account_info)
    log('hooks_info', hooks_info)


    const burn2mint = {
        TransactionType: 'AccountSet',
        Account: process.env.WALLET_ADDRESS,
        Fee: '10000000', // amout we are burning through to hooks side chain (assume actual fee is subtracted from value sent?)
        OperationLimit: 21338, // hooks side-chain id
        Flags: 0,
        Sequence: testnet_info.account_data.Sequence
    }

    const master = derive.familySeed(process.env.WALLET_KEY)
    const {signedTransaction} = sign(burn2mint, master)

    const burnt = await testnet.send({
        command: 'submit',
        tx_blob: signedTransaction
    })
    log('b2m', burnt)

}

log('heyy')
log('hello there lets transfer some XRP to HookV3Testnet via burn to Mint')
dotenv.config()
clientApp()
