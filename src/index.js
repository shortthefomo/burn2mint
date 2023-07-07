const debug = require('debug')
const log = debug('test:client')
const dotenv = require('dotenv')
const { XrplClient } = require('xrpl-client')

// these definitions should be manually fetch for now, they are left in the repo for convienance, and should be dump them into customeDefinitions.json (this is discribed in the documentation)
// curl --location --request POST 'https://hooks-testnet-v3.xrpl-labs.com' --header 'Content-Type: application/json' --data-raw '{
//     "method": "server_definitions",
//     "params": []
//         }' | jq .
const defs = require('../customDefinitions.json')
const lib = require('xrpl-accountlib')
const definitions = new lib.XrplDefinitions(defs)

const axios = require('axios')

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

    const hash = await burnTokens(testnet_info)

    // next up is fetching the XPOP from a burn node, there is no disrciption to run a node yet... or any avilable nodes to fetch this xpop from yet.
    const xpop = await fetchXPOP(hash) 

    if (xpop) {
        // final step is the mint transaction. 
        await mintTokens(hooks_info, xpop)
    }

    // close our connections
    testnet.close()
    hooks.close()
}

// STEP 1
async function burnTokens(testnet_info) {
    const burn2mint = {
        TransactionType: 'AccountSet',
        Account: process.env.WALLET_ADDRESS,
        Fee: '1000', // amout we are burning through to hooks side chain (assume actual fee is subtracted from value sent?)
        OperationLimit: 21338, // hooks side-chain id
        Flags: 0,
        Sequence: testnet_info.account_data.Sequence
    }

    const master = lib.derive.familySeed(process.env.WALLET_KEY)
    const {signedTransaction} = lib.sign(burn2mint, master)

    const burnt = await testnet.send({
        command: 'submit',
        tx_blob: signedTransaction
    })
    
    log('b2m', burnt)
    return burnt.tx_json.hash
}

// STEP 2
async function fetchXPOP(hash, retry = 10) {
    
    log('fetching', `https://testnet.transia.co/xpop/${hash}`)

    // this is just a public hooks-testnet-v3 burn node use this or setup your own burn node which is out of the 
    // scope of this example
    try {
        const headers = { 'Content-Type': 'application/json; charset=utf-8' }
        const {data} = await axios.get(`https://testnet.transia.co/xpop/${hash}`, { headers })
        log('data', data)
        return  Buffer.from(JSON.stringify(data), 'utf-8')
    } catch (e) {
        if (retry >= 0) {
            await pause(5000)
            return fetchXPOP(hash, retry - 1)
        }
    }
    return false
}

async function pause(milliseconds = 1000) {
    return new Promise(resolve =>  {
        console.log('pausing....')
        setTimeout(resolve, milliseconds)
    })
}

// STEP 3
async function mintTokens(hooks_info, xpop) {
    // log('XPOP HEX', xpop.toString('hex').toUpperCase())
    const master = lib.derive.familySeed(process.env.WALLET_KEY)
    const mint = {
        TransactionType: 'Import',
        Account: process.env.WALLET_ADDRESS,
        Blob: xpop.toString('hex').toUpperCase(),
        Sequence: hooks_info.account_data.Sequence,
        Fee: '0',
        NetworkID: 21338
    }
    log('minting', mint)
    // log('definitions', definitions)
    const {signedTransaction} = lib.sign(mint, master, definitions)
    const minted = await hooks.send({
        command: 'submit',
        tx_blob: signedTransaction
    })
        
    log('minted', minted)
}

log('lets transfer some XRP to HookV3Testnet via Burn2Mint')
dotenv.config()
clientApp()