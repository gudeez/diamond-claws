// Deployment script for Diamond Claws contracts
const hre = require("hardhat");

async function main() {
  const [deployer] = await hre.ethers.getSigners();
  console.log("Deploying contracts with account:", deployer.address);
  console.log("Account balance:", (await hre.ethers.provider.getBalance(deployer.address)).toString());

  // Deploy DiamondClaws (DCLAW) token
  console.log("\nDeploying DiamondClaws token...");
  const DiamondClaws = await hre.ethers.getContractFactory("DiamondClaws");
  const dclaw = await DiamondClaws.deploy(deployer.address, deployer.address);
  await dclaw.waitForDeployment();
  const dclawAddress = await dclaw.getAddress();
  console.log("DiamondClaws deployed to:", dclawAddress);

  // Deploy Staking contract
  console.log("\nDeploying DiamondClawsStaking...");
  const DiamondClawsStaking = await hre.ethers.getContractFactory("DiamondClawsStaking");
  const staking = await DiamondClawsStaking.deploy(dclawAddress, deployer.address, deployer.address);
  await staking.waitForDeployment();
  const stakingAddress = await staking.getAddress();
  console.log("DiamondClawsStaking deployed to:", stakingAddress);

  // Set staking contract in token
  console.log("\nSetting staking contract in token...");
  await dclaw.setStakingContract(stakingAddress);

  // Deploy Swap contract
  console.log("\nDeploying DiamondClawsSwap...");
  const DiamondClawsSwap = await hre.ethers.getContractFactory("DiamondClawsSwap");
  const swap = await DiamondClawsSwap.deploy(dclawAddress, deployer.address);
  await swap.waitForDeployment();
  const swapAddress = await swap.getAddress();
  console.log("DiamondClawsSwap deployed to:", swapAddress);

  // Exclude swap contract from taxes
  console.log("\nExcluding swap contract from taxes...");
  await dclaw.setTaxExcluded(swapAddress, true);

  // Fund swap contract with DCLAW liquidity (100M tokens = 10% of supply)
  const LIQUIDITY = hre.ethers.parseEther("100000000"); // 100M DCLAW
  console.log("\nFunding swap contract with 100M DCLAW...");
  await dclaw.transfer(swapAddress, LIQUIDITY);
  console.log("Swap contract funded");

  // Verify contracts on Etherscan (if not local)
  if (hre.network.name !== "localhost" && hre.network.name !== "hardhat") {
    console.log("\nVerifying contracts...");
    try {
      await hre.run("verify:verify", {
        address: dclawAddress,
        constructorArguments: [deployer.address, deployer.address],
      });
      console.log("DiamondClaws verified");

      await hre.run("verify:verify", {
        address: stakingAddress,
        constructorArguments: [dclawAddress, deployer.address, deployer.address],
      });
      console.log("DiamondClawsStaking verified");

      await hre.run("verify:verify", {
        address: swapAddress,
        constructorArguments: [dclawAddress, deployer.address],
      });
      console.log("DiamondClawsSwap verified");
    } catch (e) {
      console.log("Verification failed:", e.message);
    }
  }

  console.log("\n========== DEPLOYMENT SUMMARY ==========");
  console.log("DiamondClaws (DCLAW):", dclawAddress);
  console.log("DiamondClawsStaking:", stakingAddress);
  console.log("DiamondClawsSwap:", swapAddress);
  console.log("========================================");
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
