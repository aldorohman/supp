require("dotenv").config();
const { ethers } = require("ethers");  // Fixed import
const colors = require("colors");
const readline = require("readline");

// Initialize colors
colors.enable();

// ======================
// CONFIGURATION
// ======================
const RPC_URL = "https://rpc.soniclabs.com";
const EXPLORER_URL = "https://sonicscan.org/tx/";

// Contract addresses
const WS_TOKEN_ADDRESS = "0x039e2fB66102314Ce7b64Ce5Ce3E5183bc94aD38";
const LENDING_POOL_ADDRESS = "0x5362dBb1e601abF3a4c14c22ffEdA64042E5eAA3";

// Gas settings
const GAS_LIMIT = 350000;
const MAX_RETRIES = 3;
const MIN_STAKE_AMOUNT = ethers.utils.parseEther("0.01");
const MAX_STAKE_AMOUNT = ethers.utils.parseEther("0.05");

// ======================
// INITIALIZATION
// ======================
const provider = new ethers.providers.JsonRpcProvider(RPC_URL);
const wallet = new ethers.Wallet(process.env.PRIVATE_KEY, provider);

// Contract ABIs
const LENDING_POOL_ABI = [
  "function deposit(address asset, uint256 amount, address onBehalfOf, uint16 referralCode) external",
  "function withdraw(address asset, uint256 amount, address to) external returns (uint256)"
];

const WS_TOKEN_ABI = [
  "function approve(address spender, uint256 amount) external returns (bool)",
  "function balanceOf(address account) external view returns (uint256)"
];

const lendingPool = new ethers.Contract(LENDING_POOL_ADDRESS, LENDING_POOL_ABI, wallet);
const wsToken = new ethers.Contract(WS_TOKEN_ADDRESS, WS_TOKEN_ABI, wallet);

const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout,
});

// ======================
// UTILITY FUNCTIONS
// ======================
function getRandomAmount() {
  const min = parseFloat(ethers.utils.formatEther(MIN_STAKE_AMOUNT));
  const max = parseFloat(ethers.utils.formatEther(MAX_STAKE_AMOUNT));
  const randomAmount = Math.random() * (max - min) + min;
  return ethers.utils.parseEther(randomAmount.toFixed(4));
}

function getRandomDelay() {
  const minDelay = 1 * 60 * 1000;
  const maxDelay = 3 * 60 * 1000;
  return Math.floor(Math.random() * (maxDelay - minDelay + 1) + minDelay);
}

const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function getCurrentGasFees() {
  try {
    const feeData = await provider.getFeeData();
    return {
      maxFeePerGas: feeData.maxFeePerGas?.mul(130).div(100) || ethers.utils.parseUnits("25", "gwei"),
      maxPriorityFeePerGas: feeData.maxPriorityFeePerGas?.mul(130).div(100) || ethers.utils.parseUnits("3", "gwei")
    };
  } catch (error) {
    console.error("❌ Gas fee estimation failed, using defaults:".yellow, error.message);
    return {
      maxFeePerGas: ethers.utils.parseUnits("25", "gwei"),
      maxPriorityFeePerGas: ethers.utils.parseUnits("3", "gwei")
    };
  }
}

async function checkApproval() {
  try {
    const allowance = await wsToken.allowance(wallet.address, LENDING_POOL_ADDRESS);
    if (allowance.lt(ethers.utils.parseEther("1"))) {
      console.log("⏳ Approving wS tokens...".yellow);
      const tx = await wsToken.approve(
        LENDING_POOL_ADDRESS,
        ethers.constants.MaxUint256,
        { gasLimit: GAS_LIMIT }
      );
      await tx.wait();
      console.log("✔️ Approval successful".green);
    }
  } catch (error) {
    console.error("❌ Approval failed:".red, error.message);
    throw error;
  }
}

async function checkBalances() {
  try {
    const [ethBalance, wsBalance] = await Promise.all([
      provider.getBalance(wallet.address),
      wsToken.balanceOf(wallet.address)
    ]);
    
    console.log("\nCurrent Balances:".cyan);
    console.log(`- ETH: ${ethers.utils.formatEther(ethBalance)}`.cyan);
    console.log(`- wS: ${ethers.utils.formatEther(wsBalance)}`.cyan);
    
    return { ethBalance, wsBalance };
  } catch (error) {
    console.error("❌ Balance check failed:".red, error.message);
    throw error;
  }
}

async function withRetry(operation, maxRetries = MAX_RETRIES) {
  let attempts = 0;
  while (attempts < maxRetries) {
    try {
      return await operation();
    } catch (error) {
      attempts++;
      if (attempts >= maxRetries) throw error;
      
      const delayTime = Math.pow(2, attempts) * 1000;
      console.log(`⏳ Retrying in ${delayTime/1000}s... (${attempts}/${maxRetries})`.yellow);
      await delay(delayTime);
    }
  }
}

// ======================
// CORE FUNCTIONS
// ======================
async function supplyWS(cycleNumber) {
  return withRetry(async () => {
    console.log(`\n[Cycle ${cycleNumber}] Preparing to stake...`.magenta);

    await checkApproval();
    const { wsBalance, ethBalance } = await checkBalances();
    const stakeAmount = getRandomAmount();
    
    console.log(`Amount: ${ethers.utils.formatEther(stakeAmount)} wS`);

    if (wsBalance.lt(stakeAmount)) {
      throw new Error("Insufficient wS balance");
    }

    const minEth = ethers.utils.parseEther("0.01");
    if (ethBalance.lt(minEth)) {
      throw new Error("Insufficient ETH for gas");
    }

    const { maxFeePerGas, maxPriorityFeePerGas } = await getCurrentGasFees();

    const tx = await lendingPool.deposit(
      WS_TOKEN_ADDRESS,
      stakeAmount,
      wallet.address,
      0, // referralCode
      {
        gasLimit: GAS_LIMIT,
        maxFeePerGas,
        maxPriorityFeePerGas
      }
    );

    console.log(`🔄 Tx sent: ${EXPLORER_URL}${tx.hash}`.yellow);
    const receipt = await tx.wait();

    if (receipt.status === 0) {
      throw new Error("Transaction reverted");
    }

    console.log(`✔️ Staked in block ${receipt.blockNumber}`.green);
    return { receipt, stakeAmount };
  });
}

async function withdrawWS(cycleNumber) {
  return withRetry(async () => {
    console.log(`\n[Cycle ${cycleNumber}] Preparing to unstake...`.magenta);

    const { maxFeePerGas, maxPriorityFeePerGas } = await getCurrentGasFees();

    const tx = await lendingPool.withdraw(
      WS_TOKEN_ADDRESS,
      ethers.constants.MaxUint256, // Withdraw all
      wallet.address,
      {
        gasLimit: GAS_LIMIT,
        maxFeePerGas,
        maxPriorityFeePerGas
      }
    );

    console.log(`🔄 Tx sent: ${EXPLORER_URL}${tx.hash}`.yellow);
    const receipt = await tx.wait();

    if (receipt.status === 0) {
      throw new Error("Transaction reverted");
    }

    console.log(`✔️ Unstaked in block ${receipt.blockNumber}`.green);
    return receipt;
  });
}

// ======================
// MAIN EXECUTION
// ======================
async function main() {
  try {
    console.log("🚀 Starting Sonic Staking Bot".green.bold);
    console.log(`📌 Wallet: ${wallet.address}`.yellow);

    const cycleCount = await new Promise((resolve) => {
      rl.question("How many cycles to run? ", (answer) => {
        resolve(parseInt(answer) || 1);
      });
    });

    for (let i = 1; i <= cycleCount; i++) {
      try {
        console.log(`\n=== Cycle ${i} ===`.magenta.bold);
        await supplyWS(i);
        
        const delayTime = getRandomDelay();
        console.log(`⏳ Waiting ${delayTime/1000}s...`.cyan);
        await delay(delayTime);
        
        await withdrawWS(i);
        console.log(`=== Completed ===`.magenta.bold);
      } catch (error) {
        console.error(`❌ Cycle ${i} failed:`.red, error.message);
      }

      if (i < cycleCount) {
        const interCycleDelay = getRandomDelay();
        console.log(`\n⏳ Waiting ${interCycleDelay/1000}s between cycles...`.cyan);
        await delay(interCycleDelay);
      }
    }

    console.log(`\n🎉 All done!`.green.bold);
  } catch (error) {
    console.error("💥 Fatal error:".red.bold, error.message);
  } finally {
    rl.close();
    process.exit(0);
  }
}

process.on("SIGINT", () => {
  console.log("\n🛑 Shutting down...".yellow);
  rl.close();
  process.exit(0);
});

main();
