const debug = require('debug')
const log = debug('test:client')
const dotenv = require('dotenv')
const { XrplClient } = require('xrpl-client')
const { derive, sign } = require('xrpl-accountlib')

const testnet = new XrplClient('wss://s.altnet.rippletest.net:51233')
const hooks = new XrplClient('wss://hooks-testnet-v3.xrpl-labs.com')

// https://docs.hooks.network/testnet-v3/burn-2-mint discribes the steps needed to burn2mint

async function clientApp() {
    const account_info = {
        command: 'account_info', 
        account: process.env.WALLET_ADDRESS,
        ledger_index: 'current'
    }
    const testnet_info = await testnet.send(account_info)
    log('testnet_info', testnet_info)

    const hooks_info = await hooks.send(account_info)
    log('hooks_info', hooks_info)

    await burnTokens(testnet_info, hooks_info)

    // @todo next up is fetching the XPOP from a burn node, there is no disrciption to run a node yet... or any avilable nodes to fetch this blob from yet.
    // await fetchXPOP(account)    


    // @todo final step is the mint transaction, since we are using the xumm xrpl client we will not need to update the definitions as outlined. 
    // await mintTokens(hooks_info, blob)

    // close our connections
    testnet.close()
    hooks.close()
}

// STEP 1
async function burnTokens(testnet_info, hooks_info) {
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

// STEP 2
async function fetchXPOP(account) {

}

// STEP 3
async function mintTokens(hooks_info, blob) {
    const master = derive.familySeed(process.env.WALLET_KEY)
    const mint = {
        Account: process.env.WALLET_ADDRESS,
        TransactionType: 'Import',
        Blob: "<hex encoded (upper case) XPOP>", // use the blob from previous step here
        Sequence: hooks_info.account_data.Sequence
    }

    const {signedTransaction} = sign(mint, master)
    const minted = await hooks.send({
        command: 'submit',
        tx_blob: signedTransaction
    })
    // log('minted', minted)
}

log('lets transfer some XRP to HookV3Testnet via Burn2Mint')
dotenv.config()
clientApp()
