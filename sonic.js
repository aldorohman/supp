require('dotenv').config();
const { ethers } = require('ethers'); // Corrected import
const colors = require('colors');
const readline = require('readline');

// Initialize colors
colors.enable();

// Configuration - moved before any ethers.utils usage
const config = {
  RPC_URL: "https://rpc.soniclabs.com",
  EXPLORER_URL: "https://sonicscan.org/tx/",
  WS_TOKEN_ADDRESS: "0x039e2fB66102314Ce7b64Ce5Ce3E5183bc94aD38",
  LENDING_POOL_ADDRESS: "0x5362dBb1e601abF3a4c14c22ffEdA64042E5eAA3",
  GAS_LIMIT: 350000,
  MAX_RETRIES: 3,
  get MIN_STAKE() { return ethers.utils.parseEther("0.01") }, // Fixed initialization
  get MAX_STAKE() { return ethers.utils.parseEther("0.05") } // Fixed initialization
};

// Initialize provider and wallet
const provider = new ethers.providers.JsonRpcProvider(config.RPC_URL);
const wallet = new ethers.Wallet(process.env.PRIVATE_KEY, provider);

// Contract ABIs
const contracts = {
  lendingPool: new ethers.Contract(
    config.LENDING_POOL_ADDRESS,
    [
      "function deposit(address asset, uint256 amount, address onBehalfOf, uint16 referralCode) external",
      "function withdraw(address asset, uint256 amount, address to) external returns (uint256)"
    ],
    wallet
  ),
  wsToken: new ethers.Contract(
    config.WS_TOKEN_ADDRESS,
    [
      "function approve(address spender, uint256 amount) external returns (bool)",
      "function balanceOf(address account) external view returns (uint256)"
    ],
    wallet
  )
};

// Setup readline
const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout
});

// Utility functions
const utils = {
  getRandomAmount: () => {
    const min = parseFloat(ethers.utils.formatEther(config.MIN_STAKE));
    const max = parseFloat(ethers.utils.formatEther(config.MAX_STAKE));
    const amount = Math.random() * (max - min) + min;
    return ethers.utils.parseEther(amount.toFixed(4));
  },
  getRandomDelay: () => Math.floor(Math.random() * (120000 - 60000 + 1)) + 60000,
  delay: (ms) => new Promise(resolve => setTimeout(resolve, ms)),
  getGasFees: async () => {
    try {
      const feeData = await provider.getFeeData();
      return {
        maxFeePerGas: feeData.maxFeePerGas?.mul(130).div(100) || ethers.utils.parseUnits("25", "gwei"),
        maxPriorityFeePerGas: feeData.maxPriorityFeePerGas?.mul(130).div(100) || ethers.utils.parseUnits("3", "gwei")
      };
    } catch (error) {
      console.error("⚠️  Using default gas fees".yellow);
      return {
        maxFeePerGas: ethers.utils.parseUnits("25", "gwei"),
        maxPriorityFeePerGas: ethers.utils.parseUnits("3", "gwei")
      };
    }
  },
  checkApproval: async () => {
    const allowance = await contracts.wsToken.allowance(wallet.address, config.LENDING_POOL_ADDRESS);
    if (allowance.lt(config.MIN_STAKE)) {
      console.log("🔏 Approving wS tokens...".yellow);
      const tx = await contracts.wsToken.approve(
        config.LENDING_POOL_ADDRESS,
        ethers.constants.MaxUint256,
        { gasLimit: config.GAS_LIMIT }
      );
      await tx.wait();
      console.log("✅ Approval confirmed".green);
    }
  },
  checkBalances: async () => {
    const [eth, ws] = await Promise.all([
      provider.getBalance(wallet.address),
      contracts.wsToken.balanceOf(wallet.address)
    ]);
    console.log("\n💵 Balances:".cyan);
    console.log(`- ETH: ${ethers.utils.formatEther(eth)}`.cyan);
    console.log(`- wS: ${ethers.utils.formatEther(ws)}`.cyan);
    return { eth, ws };
  },
  withRetry: async (fn, maxRetries = config.MAX_RETRIES) => {
    let attempts = 0;
    while (attempts < maxRetries) {
      try {
        return await fn();
      } catch (error) {
        attempts++;
        if (attempts >= maxRetries) throw error;
        const delay = Math.pow(2, attempts) * 1000;
        console.log(`↻ Retry ${attempts}/${maxRetries} in ${delay/1000}s...`.yellow);
        await utils.delay(delay);
      }
    }
  }
};

// Main functions
async function stake(cycle) {
  return utils.withRetry(async () => {
    console.log(`\n🔄 [Cycle ${cycle}] Staking wS...`.magenta);
    
    await utils.checkApproval();
    const { ws } = await utils.checkBalances();
    const amount = utils.getRandomAmount();
    
    console.log(`💎 Amount: ${ethers.utils.formatEther(amount)} wS`);

    if (ws.lt(amount)) throw new Error("Insufficient wS balance");
    
    const gas = await utils.getGasFees();
    const tx = await contracts.lendingPool.deposit(
      config.WS_TOKEN_ADDRESS,
      amount,
      wallet.address,
      0,
      { ...gas, gasLimit: config.GAS_LIMIT }
    );

    console.log(`📤 Tx: ${config.EXPLORER_URL}${tx.hash}`.yellow);
    const receipt = await tx.wait();
    if (!receipt.status) throw new Error("Staking failed");
    
    console.log(`✅ Staked in block ${receipt.blockNumber}`.green);
    return { amount, receipt };
  });
}

async function unstake(cycle) {
  return utils.withRetry(async () => {
    console.log(`\n🔄 [Cycle ${cycle}] Unstaking...`.magenta);
    
    const gas = await utils.getGasFees();
    const tx = await contracts.lendingPool.withdraw(
      config.WS_TOKEN_ADDRESS,
      ethers.constants.MaxUint256,
      wallet.address,
      { ...gas, gasLimit: config.GAS_LIMIT }
    );

    console.log(`📤 Tx: ${config.EXPLORER_URL}${tx.hash}`.yellow);
    const receipt = await tx.wait();
    if (!receipt.status) throw new Error("Unstaking failed");
    
    console.log(`✅ Unstaked in block ${receipt.blockNumber}`.green);
    return receipt;
  });
}

// Execution flow
async function run() {
  try {
    console.log("\n🚀 Sonic Staking Bot".green.bold);
    console.log(`📍 Wallet: ${wallet.address}`.yellow);

    const cycles = await new Promise(resolve => {
      rl.question("How many cycles to run? ", answer => {
        resolve(parseInt(answer) || 1);
      });
    });

    for (let i = 1; i <= cycles; i++) {
      try {
        console.log(`\n🌀 Cycle ${i}/${cycles}`.magenta.bold);
        await stake(i);
        await utils.delay(utils.getRandomDelay());
        await unstake(i);
        console.log(`🎉 Cycle ${i} complete!`.magenta.bold);
      } catch (error) {
        console.error(`❌ Cycle ${i} failed:`.red, error.message);
      }

      if (i < cycles) {
        const delay = utils.getRandomDelay();
        console.log(`\n⏳ Next cycle in ${delay/1000}s...`.cyan);
        await utils.delay(delay);
      }
    }

    console.log("\n✨ All cycles completed!".green.bold);
  } catch (error) {
    console.error("\n💥 Critical error:".red.bold, error.message);
  } finally {
    rl.close();
    process.exit(0);
  }
}

// Handle shutdown
process.on('SIGINT', () => {
  console.log('\n🛑 Stopping bot...'.yellow);
  rl.close();
  process.exit(0);
});

// Start the bot
run();
