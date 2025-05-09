require("dotenv").config();
const { ethers } = require("ethers");
const colors = require("colors");
const readline = require("readline");
const displayHeader = require("../src/displayHeader.js");
displayHeader();

// Configuration based on the logs
const RPC_URL = "https://sonic-testnet.rpc.url"; // Replace with actual Sonic testnet RPC
const EXPLORER_URL = "https://testnet.sonicscan.io/tx/";
const PRIVATE_KEY = process.env.PRIVATE_KEY;

// Contract addresses from logs
const WS_TOKEN = "0x039e2fb66102314ce7b64ce5ce3e5183bc94ad38"; // wS Token
const USDCe_TOKEN = "0x29219dd400f2bf60e5a23d13be72b486d4038894"; // Bridged USDC.e
const BEETS_VAULT = "0xBA12222222228d8Ba445958a75a0704d566BF2C8"; // Beets Vault
const STAKED_SONIC = "0xe5da20f15420ad15de0fa650600afc998bbe3955"; // Staked Sonic

// Initialize provider and wallet
const provider = new ethers.providers.JsonRpcProvider(RPC_URL);
const wallet = new ethers.Wallet(PRIVATE_KEY, provider);

// Contract ABIs
const ERC20_ABI = [
    "function balanceOf(address) view returns (uint)",
    "function approve(address spender, uint256 amount) returns (bool)",
    "function transfer(address to, uint256 amount) returns (bool)",
    "function deposit() payable",
    "function withdraw(uint256 amount)"
];

const BEETS_VAULT_ABI = [
    "function swap(bytes32 poolId, address tokenIn, address tokenOut, uint256 amountIn, uint256 minAmountOut) external"
];

// Initialize contracts
const wSContract = new ethers.Contract(WS_TOKEN, ERC20_ABI, wallet);
const usdceContract = new ethers.Contract(USDCe_TOKEN, ERC20_ABI, wallet);
const beetsVault = new ethers.Contract(BEETS_VAULT, BEETS_VAULT_ABI, wallet);

// Helper functions
function getRandomAmount(min, max, decimals = 18) {
    const randomAmount = Math.random() * (max - min) + min;
    return ethers.utils.parseUnits(randomAmount.toFixed(4), decimals);
}

function getRandomDelay(minMinutes, maxMinutes) {
    const minDelay = minMinutes * 60 * 1000;
    const maxDelay = maxMinutes * 60 * 1000;
    return Math.floor(Math.random() * (maxDelay - minDelay + 1) + minDelay);
}

// Main functions
async function wrapSonic(amount) {
    try {
        console.log(`🔄 Wrapping ${ethers.utils.formatEther(amount)} SONIC into wS...`.magenta);
        const tx = await wSContract.deposit({ value: amount, gasLimit: 500000 });
        console.log(`✔️  Wrap successful`.green.underline);
        console.log(`➡️  Transaction: ${EXPLORER_URL}${tx.hash}`.yellow);
        await tx.wait();
    } catch (error) {
        console.error("❌ Error wrapping:".red, error);
    }
}

async function swapOnBeets(tokenIn, tokenOut, amountIn, minAmountOut) {
    try {
        console.log(`🔄 Swapping ${ethers.utils.formatUnits(amountIn, await getDecimals(tokenIn)} ${await getSymbol(tokenIn)} for ${await getSymbol(tokenOut)}...`.cyan);
        
        // Approve if needed
        if (tokenIn !== ethers.constants.AddressZero) {
            const approveTx = await wSContract.approve(BEETS_VAULT, amountIn);
            await approveTx.wait();
        }

        // Beets.fi pool ID from logs
        const poolId = "0xdf49944d79b4032e244063ebfe413a3179d6b2e7000100000000000000000084";
        
        const tx = await beetsVault.swap(
            poolId,
            tokenIn,
            tokenOut,
            amountIn,
            minAmountOut,
            { gasLimit: 800000 }
        );
        
        console.log(`✔️  Swap successful`.green.underline);
        console.log(`➡️  Transaction: ${EXPLORER_URL}${tx.hash}`.yellow);
        await tx.wait();
    } catch (error) {
        console.error("❌ Error swapping:".red, error);
    }
}

async function getSymbol(tokenAddress) {
    if (tokenAddress === WS_TOKEN) return "wS";
    if (tokenAddress === USDCe_TOKEN) return "USDC.e";
    if (tokenAddress === ethers.constants.AddressZero) return "SONIC";
    return "Token";
}

async function getDecimals(tokenAddress) {
    if (tokenAddress === USDCe_TOKEN) return 6;
    return 18;
}

// Main execution flow
async function executeSwapCycle() {
    // 1. Wrap random amount of SONIC to wS (0.01-0.05 like original script)
    const wrapAmount = getRandomAmount(0.01, 0.05);
    await wrapSonic(wrapAmount);

    // 2. Swap some wS to USDC.e (similar to log #11)
    const swapAmount = getRandomAmount(0.005, 0.02);
    const minAmountOut = swapAmount.div(2); // 50% slippage for testnet
    await swapOnBeets(WS_TOKEN, USDCe_TOKEN, swapAmount, minAmountOut);

    // 3. Random delay between actions (1-3 minutes)
    const delay = getRandomDelay(1, 3);
    console.log(`⏳ Waiting ${delay/60000} minutes before next cycle...`.yellow);
    await new Promise(resolve => setTimeout(resolve, delay));
}

// User interface
const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout
});

rl.question(
    "How many swap cycles would you like to run? (Press enter for default 1): ",
    (cycles) => {
        rl.question(
            "How often in hours between cycles? (Press enter for continuous): ",
            (hours) => {
                const cyclesCount = cycles ? parseInt(cycles) : 1;
                const intervalHours = hours ? parseFloat(hours) : 0;

                console.log(`Starting ${cyclesCount} cycles...`.bold);
                
                if (intervalHours > 0) {
                    // Timed execution
                    let count = 0;
                    const interval = setInterval(async () => {
                        if (count >= cyclesCount) {
                            clearInterval(interval);
                            console.log("All cycles completed!".green.bold);
                            rl.close();
                            return;
                        }
                        console.log(`\n=== Cycle ${count + 1}/${cyclesCount} ===`.bold);
                        await executeSwapCycle();
                        count++;
                    }, intervalHours * 60 * 60 * 1000);
                } else {
                    // Continuous execution
                    (async () => {
                        for (let i = 0; i < cyclesCount; i++) {
                            console.log(`\n=== Cycle ${i + 1}/${cyclesCount} ===`.bold);
                            await executeSwapCycle();
                        }
                        console.log("All cycles completed!".green.bold);
                        rl.close();
                    })();
                }
            }
        );
    }
);
