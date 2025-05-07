require("dotenv").config();
const ethers = require("ethers");
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
const ASONWS_TOKEN_ADDRESS = "0x6C5E14A212c1C3e4Baf6f871ac9B1a969918c131";

// Gas settings
const GAS_LIMIT = 350000; // Increased for Aave protocol complexity
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
  "function withdraw(address asset, uint256 amount, address to) external returns (uint256)",
  "function getReserveData(address asset) external view returns (tuple(uint256,uint256,uint256,uint256,uint256,uint256,uint256,uint256,uint40,address,address,address,address,uint8))"
];

const WS_TOKEN_ABI = [
  "function approve(address spender, uint256 amount) external returns (bool)",
  "function balanceOf(address account) external view returns (uint256)",
  "function allowance(address owner, address spender) external view returns (uint256)"
];

const ASONWS_TOKEN_ABI = [
  "function balanceOf(address account) external view returns (uint256)"
];

const lendingPool = new ethers.Contract(LENDING_POOL_ADDRESS, LENDING_POOL_ABI, wallet);
const wsToken = new ethers.Contract(WS_TOKEN_ADDRESS, WS_TOKEN_ABI, wallet);
const aSonWsToken = new ethers.Contract(ASONWS_TOKEN_ADDRESS, ASONWS_TOKEN_ABI, wallet);

const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout,
});

// ======================
// UTILITY FUNCTIONS
// ======================
function getRandomAmount() {
  const randomAmount = Math.random() * 
    (parseFloat(ethers.utils.formatEther(MAX_STAKE_AMOUNT)) - 
     parseFloat(ethers.utils.formatEther(MIN_STAKE_AMOUNT))) + 
    parseFloat(ethers.utils.formatEther(MIN_STAKE_AMOUNT));
  return ethers.utils.parseEther(randomAmount.toFixed(4));
}

function getRandomDelay() {
  const minDelay = 1 * 60 * 1000; // 1 minute
  const maxDelay = 3 * 60 * 1000; // 3 minutes
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
    const minApproval = ethers.utils.parseEther("10"); // Approve 10 WS by default
    
    if (allowance.lt(minApproval)) {
      console.log("⏳ Approving wS tokens for staking...".yellow);
      const tx = await wsToken.approve(
        LENDING_POOL_ADDRESS,
        ethers.constants.MaxUint256,
        { gasLimit: GAS_LIMIT }
      );
      await tx.wait();
      console.log("✔️ Approval successful".green);
    }
  } catch (error) {
    console.error("❌ Approval check failed:".red, error.message);
    throw error;
  }
}

async function checkReserveStatus() {
  try {
    const reserveData = await lendingPool.getReserveData(WS_TOKEN_ADDRESS);
    const isActive = reserveData[0] > 0; // Check if liquidity is available
    if (!isActive) throw new Error("Reserve is not active");
    return reserveData;
  } catch (error) {
    console.error("❌ Reserve status check failed:".red, error.message);
    throw error;
  }
}

async function checkBalances() {
  try {
    const [ethBalance, wsBalance, aSonWsBalance] = await Promise.all([
      provider.getBalance(wallet.address),
      wsToken.balanceOf(wallet.address),
      aSonWsToken.balanceOf(wallet.address)
    ]);
    
    console.log("\nCurrent Balances:".cyan);
    console.log(`- ETH: ${ethers.utils.formatEther(ethBalance)}`.cyan);
    console.log(`- wS: ${ethers.utils.formatEther(wsBalance)}`.cyan);
    console.log(`- aSonwS: ${ethers.utils.formatEther(aSonWsBalance)}`.cyan);
    
    return { ethBalance, wsBalance, aSonWsBalance };
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
      console.log(`⏳ Retrying in ${delayTime/1000}s... (Attempt ${attempts}/${maxRetries})`.yellow);
      await delay(delayTime);
    }
  }
}

// ======================
// CORE FUNCTIONS
// ======================
async function supplyWS(cycleNumber) {
  return withRetry(async () => {
    console.log(`\n[Cycle ${cycleNumber}] Preparing to stake wS...`.magenta);

    await checkApproval();
    await checkReserveStatus();
    const { wsBalance, ethBalance } = await checkBalances();
    const stakeAmount = getRandomAmount();
    
    console.log(`Random stake amount: ${ethers.utils.formatEther(stakeAmount)} wS`);

    if (wsBalance.lt(stakeAmount)) {
      throw new Error("Insufficient wS balance for staking");
    }

    // Check ETH balance for gas (conservative estimate)
    const minEthRequired = ethers.utils.parseEther("0.01");
    if (ethBalance.lt(minEthRequired)) {
      throw new Error("Insufficient ETH for gas fees");
    }

    const { maxFeePerGas, maxPriorityFeePerGas } = await getCurrentGasFees();

    // Execute deposit to lending pool
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

    console.log(`🔄 Sending stake transaction: ${EXPLORER_URL}${tx.hash}`.yellow);
    const receipt = await tx.wait();

    if (receipt.status === 0) {
      throw new Error("Transaction reverted");
    }

    console.log(`✔️ Stake successful in block ${receipt.blockNumber}`.green.underline);
    return { receipt, stakeAmount };
  });
}

async function withdrawWS(cycleNumber) {
  return withRetry(async () => {
    console.log(`\n[Cycle ${cycleNumber}] Preparing to unstake...`.magenta);
    
    const { aSonWsBalance } = await checkBalances();
    if (aSonWsBalance.lte(0)) {
      throw new Error("No aSonwS tokens to unstake");
    }

    const { maxFeePerGas, maxPriorityFeePerGas } = await getCurrentGasFees();

    // Execute withdraw from lending pool (max amount)
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

    console.log(`🔄 Sending unstake transaction: ${EXPLORER_URL}${tx.hash}`.yellow);
    const receipt = await tx.wait();

    if (receipt.status === 0) {
      throw new Error("Transaction reverted");
    }

    console.log(`✔️ Unstake successful in block ${receipt.blockNumber}`.green.underline);
    return receipt;
  });
}

// ======================
// MAIN EXECUTION
// ======================
async function main() {
  try {
    console.log("🚀 Starting wS Staking operations...".green.bold);
    console.log(`📌 Using wallet: ${wallet.address}`.yellow);
    console.log(`📌 wS Token: ${WS_TOKEN_ADDRESS}`.yellow);
    console.log(`📌 Lending Pool: ${LENDING_POOL_ADDRESS}`.yellow);

    const cycleCount = await new Promise((resolve) => {
      rl.question("How many staking cycles would you like to run? ", (answer) => {
        resolve(parseInt(answer) || 1);
      });
    });

    console.log(`🔄 Running ${cycleCount} cycles...`.yellow);

    for (let i = 1; i <= cycleCount; i++) {
      try {
        console.log(`\n=== Starting Cycle ${i} ===`.magenta.bold);
        const { stakeAmount } = await supplyWS(i);

        const delayTime = getRandomDelay();
        console.log(`⏳ Waiting for ${delayTime / 1000} seconds before unstaking...`.cyan);
        await delay(delayTime);

        await withdrawWS(i);
        console.log(`=== Cycle ${i} completed successfully! ===`.magenta.bold);
      } catch (error) {
        console.error(`❌ Cycle ${i} failed:`.red, error.message);
      }

      if (i < cycleCount) {
        const interCycleDelay = getRandomDelay();
        console.log(`\n⏳ Waiting ${interCycleDelay / 1000} seconds before next cycle...`.cyan);
        await delay(interCycleDelay);
      }
    }

    console.log(`\n🎉 All ${cycleCount} cycles completed!`.green.bold);
  } catch (error) {
    console.error("💥 Operation failed:".red.bold, error.message);
  } finally {
    rl.close();
    process.exit(0);
  }
}

// Handle process termination
process.on("SIGINT", async () => {
  console.log("\n🛑 Received shutdown signal. Gracefully terminating...".yellow);
  rl.close();
  process.exit(0);
});

// Start the program
main();
