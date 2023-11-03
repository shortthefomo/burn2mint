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

const mainnet = new XrplClient(['wss://node.panicbot.xyz', 'wss://node2.panicbot.xyz'])
const xahau = new XrplClient('wss://xahau.network')

// https://docs.hooks.network/testnet-v3/burn-2-mint discribes the steps needed to burn2mint

async function clientApp() {
    const account_info = {
        command: 'account_info', 
        account: process.env.WALLET_ADDRESS,
        ledger_index: 'current'
    }
    const mainnet_info = await mainnet.send(account_info)
    log('mainnet_info', mainnet_info)

    const xahau_info = await xahau.send(account_info)
    log('xahau_info', xahau_info)

    // can use burnTokensAccountSet(mainnet_info), burnTokensSetRegularKey(mainnet_info) or burnTokensSignerListSet(mainnet_info) all options will burn and mint
    const hash = await burnTokensAccountSet(mainnet_info)

    // next up is fetching the XPOP from a burn node, there is no disrciption to run a node yet... or any avilable nodes to fetch this xpop from yet.
    const xpop = await fetchXPOP(hash) 

    if (xpop) {
        // final step is the mint transaction. 
        await mintTokens(xahau_info, xpop)
    }

    // close our connections
    mainnet.close()
    xahau.close()
}

// STEP 1 (baisc)
async function burnTokensAccountSet(mainnet_info) {
    const burn2mint = {
        TransactionType: 'AccountSet',
        Account: process.env.WALLET_ADDRESS,
        Fee: '1000000', // the amout we are burning through to hooks side chain
        OperationLimit: 21338, // hooks side-chain id
        Flags: 0,
        Sequence: mainnet_info.account_data.Sequence
    }

    const master = lib.derive.familySeed(process.env.WALLET_KEY)
    const {signedTransaction} = lib.sign(burn2mint, master)

    const burnt = await mainnet.send({
        command: 'submit',
        tx_blob: signedTransaction
    })
    
    log('b2m via AccountSet', burnt)
    return burnt.tx_json.hash
}

// STEP 1 (baisc alternative)
async function burnTokensSetRegularKey(mainnet_info) {
    // adjust the RegularKey address as needed for your needs.
    const burn2mint = {
        TransactionType: 'SetRegularKey',
        Account: process.env.WALLET_ADDRESS,
        Fee: '1000000', // the amout we are burning through to hooks side chain
        OperationLimit: 21338, // hooks side-chain id
        Flags: 0,
        Sequence: mainnet_info.account_data.Sequence,
        RegularKey: 'rMzF7b9QzZ2FXfHtArp1ezvoRsJkbCDmvC'
    }

    const master = lib.derive.familySeed(process.env.WALLET_KEY)
    const {signedTransaction} = lib.sign(burn2mint, master)

    const burnt = await mainnet.send({
        command: 'submit',
        tx_blob: signedTransaction
    })
    
    log('b2m via TokensSetRegularKey', burnt)
    return burnt.tx_json.hash
}

// STEP 1 (advanced)
async function burnTokensSignerListSet(mainnet_info) {
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
        Sequence: mainnet_info.account_data.Sequence,
        SignerQuorum: 2,
        SignerEntries: SignerEntries
    }

    const master = lib.derive.familySeed(process.env.WALLET_KEY)
    const {signedTransaction} = lib.sign(burn2mint, master)

    const burnt = await mainnet.send({
        command: 'submit',
        tx_blob: signedTransaction
    })
    
    log('b2m via SignerListSet', burnt)
    return burnt.tx_json.hash
}

// STEP 2
async function fetchXPOP(hash, retry = 10) {
    
    log('fetching', `https://xpop.panicbot.xyz/xpop/${hash}`)

    // this is just a public hooks-testnet-v3 burn node use this or setup your own burn node which is out of the 
    // scope of this example
    try {
        const headers = { 'Content-Type': 'application/json; charset=utf-8' }
        const {data} = await axios.get(`https://xpop.panicbot.xyz/xpop/${hash}`, { headers })
        log('data', data)
        return  Buffer.from(JSON.stringify(data), 'utf-8')
    } catch (e) {
        if (retry > 0) {
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
async function mintTokens(xahau_info, xpop) {
    // log('XPOP HEX', xpop.toString('hex').toUpperCase())

    // i am using a pre-existing account on the hooks side chain here...
    // so i need to look up the current Sequence number.
    // if you will be moving tokens to a "new" account on the side chain
    // set the Sequence to 0
    const master = lib.derive.familySeed(process.env.WALLET_KEY)
    const mint = {
        TransactionType: 'Import',
        Account: process.env.WALLET_ADDRESS,
        Blob: xpop.toString('hex').toUpperCase(),
        Sequence: xahau_info.account_data.Sequence,
        Fee: '0',
        NetworkID: 21338
    }
    log('minting', mint)
    // log('definitions', definitions)
    const {signedTransaction} = lib.sign(mint, master, definitions)
    const minted = await xahau.send({
        command: 'submit',
        tx_blob: signedTransaction
    })
        
    log('minted', minted)
}



log('lets transfer some XRP to HookV3Testnet via Burn2Mint')
dotenv.config()
clientApp()