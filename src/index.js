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

const endpoints = [
    'https://xpop.panicbot.xyz',
    'https://xpop.xrplwin.com',
    'http://xpop.katczynski.org',
    'https://xpop.xrpl-labs.com',
    'https://xpop.noledger.net',
    'https://xpop.zerp.network',
    'https://xpop.store'
]

// https://docs.hooks.network/testnet-v3/burn-2-mint discribes the steps needed to burn2mint

async function clientApp() {
    const account_info = {
        command: 'account_info', 
        account: process.env.WALLET_ADDRESS,
        ledger_index: 'current'
    }
    const testnet_info = await testnet.send(account_info)
    log('testnet_info', testnet_info)
    if ('error' in testnet_info) {
        process.exit()    
    }

    const hooks_info = await hooks.send(account_info)
    log('hooks_info', hooks_info)
    if ('error' in hooks_info) {
        process.exit()    
    }
    
    // can use burnTokensAccountSet(testnet_info), burnTokensSetRegularKey(testnet_info) or burnTokensSignerListSet(testnet_info) all options will burn and mint
    const hash = await burnTokensAccountSet(testnet_info)

    // next up is fetching the XPOP from a burn node, there is no disrciption to run a node yet... or any avilable nodes to fetch this xpop from yet.
    const xpop_data = await fetchXPOP(hash) 
    
    log('xpop_data')

    if (xpop_data) {
        // final step is the mint transaction. 
        await mintTokens(hooks_info, xpop_data)
    }

    // close our connections
    testnet.close()
    hooks.close()
}

// STEP 1 (baisc)
async function burnTokensAccountSet(testnet_info) {
    const burn2mint = {
        TransactionType: 'AccountSet',
        Account: process.env.WALLET_ADDRESS,
        Fee: '2000000', // the amout we are burning through to hooks side chain
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
    
    log('b2m via AccountSet', burnt)
    if (burnt.engine_result !== 'tesSUCCESS') {
        process.exit()
    }
    
    return burnt.tx_json.hash
}

// STEP 1 (baisc alternative)
async function burnTokensSetRegularKey(testnet_info) {
    // adjust the RegularKey address as needed for your needs.
    const burn2mint = {
        TransactionType: 'SetRegularKey',
        Account: process.env.WALLET_ADDRESS,
        Fee: '1000000', // the amout we are burning through to hooks side chain
        OperationLimit: 21338, // hooks side-chain id
        Flags: 0,
        Sequence: testnet_info.account_data.Sequence,
        RegularKey: 'rMzF7b9QzZ2FXfHtArp1ezvoRsJkbCDmvC'
    }

    const master = lib.derive.familySeed(process.env.WALLET_KEY)
    const {signedTransaction} = lib.sign(burn2mint, master)

    const burnt = await testnet.send({
        command: 'submit',
        tx_blob: signedTransaction
    })
    
    log('b2m via TokensSetRegularKey', burnt)
    return burnt.tx_json.hash
}

// STEP 1 (advanced)
async function burnTokensSignerListSet(testnet_info) {
    // adjust addresses in signer entries as needed as well as the quorum!
    const SignerEntries = [{
            SignerEntry: {
                Account: 'rMzF7b9QzZ2FXfHtArp1ezvoRsJkbCDmvC',
                SignerWeight: 1
            }
        }, {
            SignerEntry: {
                Account: 'rHJtUU9taGpE5ZFtVXZC3Z4dbbnpdXXcnY',
                SignerWeight: 1
            }
        }
    ]

    const burn2mint = {
        TransactionType: 'SignerListSet',
        Account: process.env.WALLET_ADDRESS,
        Fee: '1000000', // the amout we are burning through to hooks side chain
        OperationLimit: 21338, // hooks side-chain id
        Flags: 0,
        Sequence: testnet_info.account_data.Sequence,
        SignerQuorum: 2,
        SignerEntries: SignerEntries
    }

    const master = lib.derive.familySeed(process.env.WALLET_KEY)
    const {signedTransaction} = lib.sign(burn2mint, master)

    const burnt = await testnet.send({
        command: 'submit',
        tx_blob: signedTransaction
    })
    
    log('b2m via SignerListSet', burnt)
    return burnt.tx_json.hash
}

// STEP 2
async function fetchXPOP(hash, retry = 10, paused = 1000) {
    for (let index = 0; index < endpoints.length; index++) {
        try {
            log('searching for xpop', `${endpoints[index]}/xpop/${hash}`)
            const headers = { 'Content-Type': 'application/json; charset=utf-8' }
            const {data} = await axios.get(`${endpoints[index]}/xpop/${hash}`, { headers })
            log('data', data)
            return JSON.stringify(data).replace(/['"]+/g, '')
        } catch (e) {
            // do nothing
        }
    }

    if (retry > 0) {
        await pause(paused)
        return fetchXPOP(hash, retry - 1)
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
async function mintTokens(hooks_info, xpop_data) {
    // log('XPOP HEX', xpop.toString('hex').toUpperCase())

    // i am using a pre-existing account on the hooks side chain here...
    // so i need to look up the current Sequence number.
    // if you will be moving tokens to a "new" account on the side chain
    // set the Sequence to 0
    const master = lib.derive.familySeed(process.env.WALLET_KEY)
    const mint = {
        TransactionType: 'Import',
        Account: process.env.WALLET_ADDRESS,
        Blob: xpop_data.toUpperCase(),
        Sequence: hooks_info.account_data.Sequence,
        Fee: '100',
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
    if (minted.engine_result === 'tesSUCCESS') {
        log('B2M tesSUCCESS')
    }
    else {
        log('B2M ' + minted.engine_result)
    }
}



log('lets transfer some XRP to HookV3Testnet via Burn2Mint')
dotenv.config()
clientApp()